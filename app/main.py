from __future__ import annotations

import base64
import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.asr_service import convert_to_wav, save_upload, transcribe_audio
from app.gsv_client import check_gsv_api, stream_synthesize, synthesize
from app.gsv_process import gsv_process_status, start_gsv_api, stop_gsv_api
from app.log_store import APP_LOG_PATH, log_exception, read_tail
from app.openai_client import chat_completion, stream_chat_completion
from app.settings import ROOT_DIR, load_settings, save_settings


STATIC_DIR = ROOT_DIR / "app" / "static"
OUTPUT_DIR = ROOT_DIR / "runtime" / "outputs"
TTS_STREAM_TTL = 600

app = FastAPI(title="Any Voice Chat")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_tts_stream_lock = threading.Lock()
_tts_streams: dict[str, dict[str, Any]] = {}


class SettingsPayload(BaseModel):
    settings: dict[str, Any]


class ChatPayload(BaseModel):
    message: str
    history: list[dict[str, str]] = []
    speak: bool = True


class TtsPayload(BaseModel):
    text: str


_sentence_end_re = re.compile(r"[。！？!?；;.．…\n]")
_soft_split_re = re.compile(r"[，,、：:]")
_terminal_punctuation_chars = set("。！？!?；;.．…")
_closing_punctuation_chars = set(")]}）】」』”’\"'")


def _stream_event(event: str, data: dict[str, Any]) -> str:
    return json.dumps({"event": event, **data}, ensure_ascii=False) + "\n"


def _warmup_gsv(settings: dict[str, Any]) -> dict[str, Any]:
    started_at = time.perf_counter()
    bytes_read = 0
    audio = stream_synthesize(settings, "你好。")
    try:
        for chunk in audio.response.iter_content(chunk_size=8192):
            if chunk:
                bytes_read += len(chunk)
    finally:
        audio.response.close()
    return {
        "ok": True,
        "bytes": bytes_read,
        "elapsed_seconds": round(time.perf_counter() - started_at, 2),
    }


def _cleanup_tts_streams() -> None:
    now = time.time()
    expired = [
        stream_id
        for stream_id, item in _tts_streams.items()
        if now - float(item.get("created_at", 0)) > TTS_STREAM_TTL
    ]
    for stream_id in expired:
        _tts_streams.pop(stream_id, None)


def _register_tts_stream(settings: dict[str, Any], text: str) -> str:
    stream_id = uuid.uuid4().hex
    with _tts_stream_lock:
        _cleanup_tts_streams()
        _tts_streams[stream_id] = {
            "settings": settings.copy(),
            "text": text,
            "created_at": time.time(),
        }
    return f"/api/tts/stream/{stream_id}"


def _iter_tts_stream_events(settings: dict[str, Any], segment: str, reveal_text: bool = False):
    audio_id = uuid.uuid4().hex
    tts_segment = segment.strip()
    if not tts_segment:
        if reveal_text:
            yield _stream_event("text_delta", {"delta": segment})
        return
    try:
        audio = stream_synthesize(settings, tts_segment)
    except Exception as exc:
        log_exception("tts.stream", exc)
        if reveal_text:
            yield _stream_event("text_delta", {"delta": segment})
        yield _stream_event("audio_error", {"audio_id": audio_id, "text": segment, "message": str(exc)})
        return

    if reveal_text:
        yield _stream_event("text_delta", {"delta": segment})
    yield _stream_event("audio_start", {"audio_id": audio_id, "text": segment, "media_type": "wav"})
    try:
        for chunk in audio.response.iter_content(chunk_size=8192):
            if chunk:
                yield _stream_event(
                    "audio_chunk",
                    {
                        "audio_id": audio_id,
                        "audio_base64": base64.b64encode(chunk).decode("ascii"),
                    },
                )
    except Exception as exc:
        log_exception("tts.stream.read", exc)
        yield _stream_event("audio_error", {"audio_id": audio_id, "text": segment, "message": str(exc)})
    finally:
        audio.response.close()
    yield _stream_event("audio_end", {"audio_id": audio_id})


def _pop_tts_segment(
    buffer: str,
    min_chars: int = 10,
    soft_chars: int = 60,
    force_chars: int = 90,
    final: bool = False,
) -> tuple[str | None, str]:
    text = buffer.strip()
    if not text:
        if final and buffer:
            return buffer, ""
        return None, buffer

    leading_end = _leading_terminal_boundary(buffer)
    if leading_end > 0:
        return buffer[:leading_end], buffer[leading_end:]

    hard_matches = _sentence_end_re.finditer(buffer)
    for match in hard_matches:
        end = _extend_punctuation_boundary(buffer, match.end())
        segment = buffer[:end]
        rest = buffer[end:]
        if _tts_text_len(segment) >= min_chars:
            return segment, rest

    if soft_chars > 0 and _tts_text_len(text) >= soft_chars:
        soft_matches = list(_soft_split_re.finditer(buffer))
        if soft_matches:
            end = soft_matches[-1].end()
            segment = buffer[:end]
            rest = buffer[end:]
            if _tts_text_len(segment) >= min_chars:
                return segment, rest

    if force_chars > 0 and _tts_text_len(text) >= force_chars:
        return buffer, ""

    if final:
        return buffer, ""
    return None, buffer


def _tts_text_len(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def _has_speakable_text(text: str) -> bool:
    return any(char.isalnum() for char in text)


def _leading_terminal_boundary(buffer: str) -> int:
    index = 0
    while index < len(buffer) and buffer[index].isspace():
        index += 1
    start = index
    while index < len(buffer) and buffer[index] in _terminal_punctuation_chars:
        index += 1
    if index == start:
        return 0
    while index < len(buffer) and buffer[index] in _closing_punctuation_chars:
        index += 1
    return index


def _extend_punctuation_boundary(buffer: str, end: int) -> int:
    while end < len(buffer) and buffer[end] in _terminal_punctuation_chars:
        end += 1
    while end < len(buffer) and buffer[end] in _closing_punctuation_chars:
        end += 1
    return end


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/admin")
def admin():
    return FileResponse(STATIC_DIR / "admin.html")


@app.get("/api/settings")
def get_settings():
    return load_settings()


@app.post("/api/settings")
def update_settings(payload: SettingsPayload):
    return save_settings(payload.settings)


@app.get("/api/health")
def health():
    settings = load_settings()
    return {"gsv": gsv_process_status(settings)}


@app.post("/api/gsv/start")
def start_gsv(payload: SettingsPayload | None = None):
    settings = save_settings(payload.settings) if payload else load_settings()
    try:
        result = start_gsv_api(settings)
    except Exception as exc:
        log_exception("gsv.start", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not result.get("ok"):
        log_exception("gsv.start", RuntimeError(str(result)))
        raise HTTPException(status_code=400, detail=result)
    try:
        result["warmup"] = _warmup_gsv(settings)
    except Exception as exc:
        log_exception("gsv.warmup", exc)
        raise HTTPException(status_code=400, detail=f"GSV 已连接，但预热失败：{exc}") from exc
    return result


@app.post("/api/gsv/stop")
def stop_gsv():
    return stop_gsv_api(load_settings())


@app.post("/api/asr")
async def asr(audio: UploadFile = File(...), language: str = "zh"):
    try:
        raw_path = save_upload(await audio.read(), audio.filename)
        wav_path = convert_to_wav(raw_path)
        text = transcribe_audio(wav_path, language)
    except Exception as exc:
        log_exception("asr", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"text": text}


@app.post("/api/chat")
def chat(payload: ChatPayload):
    settings = load_settings()
    user_text = payload.message.strip()
    if not user_text:
        raise HTTPException(status_code=400, detail="消息不能为空")
    try:
        assistant_text = chat_completion(settings, user_text, payload.history)
        audio_url = None
        if payload.speak:
            audio_path = synthesize(settings, assistant_text)
            audio_url = f"/api/audio/{audio_path.name}"
    except Exception as exc:
        log_exception("chat", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"user_text": user_text, "assistant_text": assistant_text, "audio_url": audio_url}


@app.post("/api/chat/stream")
def chat_stream(payload: ChatPayload):
    settings = load_settings()
    user_text = payload.message.strip()
    if not user_text:
        raise HTTPException(status_code=400, detail="消息不能为空")

    def generate():
        assistant_text = ""
        tts_buffer = ""
        speak_enabled = payload.speak and settings.get("enable_gsv_tts", True)
        text_display_mode = settings.get("text_display_mode") or "speech_sync"
        reveal_text_immediately = (not speak_enabled) or text_display_mode == "text_first"
        min_segment_chars = int(settings.get("tts_min_segment_chars") or 10)
        soft_segment_chars = int(settings.get("tts_soft_segment_chars") or 0)
        force_segment_chars = int(settings.get("tts_force_segment_chars") or 0)

        if speak_enabled:
            gsv_health = check_gsv_api(settings)
            if not gsv_health.get("ok"):
                yield _stream_event(
                    "error",
                    {
                        "message": f"已启用 GSV 语音合成，但 GSV 未连接：{gsv_health.get('error') or gsv_health.get('message') or gsv_health.get('status_code') or '未知状态'}",
                    },
                )
                return

        yield _stream_event("start", {"user_text": user_text})
        try:
            for delta in stream_chat_completion(settings, user_text, payload.history):
                assistant_text += delta
                tts_buffer += delta
                if reveal_text_immediately:
                    yield _stream_event("text_delta", {"delta": delta})

                while True:
                    segment, tts_buffer = _pop_tts_segment(
                        tts_buffer,
                        min_chars=min_segment_chars,
                        soft_chars=soft_segment_chars,
                        force_chars=force_segment_chars,
                    )
                    if segment is None:
                        break
                    if speak_enabled:
                        if _has_speakable_text(segment):
                            yield from _iter_tts_stream_events(settings, segment)
                        elif not reveal_text_immediately:
                            yield _stream_event("text_delta", {"delta": segment})

            while True:
                segment, tts_buffer = _pop_tts_segment(
                    tts_buffer,
                    min_chars=min_segment_chars,
                    soft_chars=soft_segment_chars,
                    force_chars=force_segment_chars,
                    final=True,
                )
                if segment is None:
                    break
                if speak_enabled:
                    if _has_speakable_text(segment):
                        yield from _iter_tts_stream_events(settings, segment)
                    elif not reveal_text_immediately:
                        yield _stream_event("text_delta", {"delta": segment})
                if not tts_buffer:
                    break

            yield _stream_event("done", {"assistant_text": assistant_text})
        except Exception as exc:
            log_exception("chat.stream", exc)
            yield _stream_event("error", {"message": str(exc)})

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@app.get("/api/tts/stream/{stream_id}")
def tts_audio_stream(stream_id: str):
    with _tts_stream_lock:
        _cleanup_tts_streams()
        item = _tts_streams.get(stream_id)
    if not item:
        raise HTTPException(status_code=404, detail="语音流已过期或不存在")

    try:
        audio = stream_synthesize(item["settings"], item["text"])
    except Exception as exc:
        log_exception("tts.stream", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    def generate_audio():
        try:
            for chunk in audio.response.iter_content(chunk_size=8192):
                if chunk:
                    yield chunk
        finally:
            audio.response.close()

    return StreamingResponse(generate_audio(), media_type=audio.media_type)


@app.post("/api/voice-chat")
async def voice_chat(audio: UploadFile = File(...), language: str = "zh"):
    settings = load_settings()
    try:
        raw_path = save_upload(await audio.read(), audio.filename)
        wav_path = convert_to_wav(raw_path)
        user_text = transcribe_audio(wav_path, language)
        if not user_text:
            raise ValueError("没有识别到语音内容")
        assistant_text = chat_completion(settings, user_text, [])
        audio_path = synthesize(settings, assistant_text)
    except Exception as exc:
        log_exception("voice_chat", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "user_text": user_text,
        "assistant_text": assistant_text,
        "audio_url": f"/api/audio/{audio_path.name}",
    }


@app.post("/api/tts")
def tts(payload: TtsPayload):
    settings = load_settings()
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="合成文本不能为空")
    try:
        audio_path = synthesize(settings, text)
    except Exception as exc:
        log_exception("tts", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"audio_url": f"/api/audio/{audio_path.name}"}


@app.get("/api/audio/{filename}")
def audio(filename: str):
    path = (OUTPUT_DIR / filename).resolve()
    if not str(path).startswith(str(OUTPUT_DIR.resolve())) or not path.exists():
        raise HTTPException(status_code=404, detail="音频不存在")
    return FileResponse(path)


@app.get("/api/admin/status")
def admin_status():
    settings = load_settings()
    safe_settings = settings.copy()
    if safe_settings.get("openai_api_key"):
        safe_settings["openai_api_key"] = "已填写"
    return {
        "settings": safe_settings,
        "gsv": gsv_process_status(settings),
        "paths": {
            "app_log": str(APP_LOG_PATH),
            "runtime": str(ROOT_DIR / "runtime"),
        },
    }


@app.get("/api/admin/logs")
def admin_logs():
    from app.gsv_process import GSV_LOG_PATH

    return {
        "app": read_tail(APP_LOG_PATH),
        "gsv": read_tail(GSV_LOG_PATH),
    }
