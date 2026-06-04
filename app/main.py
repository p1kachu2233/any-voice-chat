from __future__ import annotations

import json
import queue
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.asr_service import convert_to_wav, save_upload, transcribe_audio
from app.gsv_client import apply_gsv_models, synthesize
from app.gsv_process import gsv_process_status, start_gsv_api, stop_gsv_api
from app.log_store import APP_LOG_PATH, log_exception, read_tail
from app.openai_client import chat_completion, stream_chat_completion
from app.settings import ROOT_DIR, load_settings, save_settings


STATIC_DIR = ROOT_DIR / "app" / "static"
OUTPUT_DIR = ROOT_DIR / "runtime" / "outputs"

app = FastAPI(title="Any Voice Chat")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class SettingsPayload(BaseModel):
    settings: dict[str, Any]


class ChatPayload(BaseModel):
    message: str
    history: list[dict[str, str]] = []
    speak: bool = True


class TtsPayload(BaseModel):
    text: str


_sentence_end_re = re.compile(r"[。！？!?；;\n]")
_soft_split_re = re.compile(r"[，,、：:]")


def _stream_event(event: str, data: dict[str, Any]) -> str:
    return json.dumps({"event": event, **data}, ensure_ascii=False) + "\n"


def _pop_tts_segment(buffer: str, final: bool = False) -> tuple[str | None, str]:
    text = buffer.strip()
    if not text:
        return None, ""

    hard_matches = list(_sentence_end_re.finditer(buffer))
    if hard_matches:
        end = hard_matches[-1].end()
        segment = buffer[:end].strip()
        rest = buffer[end:]
        if len(segment) >= 4:
            return segment, rest

    if len(text) >= 60:
        soft_matches = list(_soft_split_re.finditer(buffer))
        if soft_matches:
            end = soft_matches[-1].end()
            segment = buffer[:end].strip()
            rest = buffer[end:]
            if len(segment) >= 12:
                return segment, rest

    if len(text) >= 90:
        return text, ""

    if final:
        return text, ""
    return None, buffer


def _iter_completed_audio(audio_queue: queue.Queue):
    while True:
        try:
            yield audio_queue.get_nowait()
        except queue.Empty:
            break


def _submit_tts(executor: ThreadPoolExecutor, audio_queue: queue.Queue, settings: dict[str, Any], segment: str) -> None:
    def worker():
        try:
            audio_path = synthesize(settings, segment)
            audio_queue.put(
                {
                    "event": "audio",
                    "text": segment,
                    "audio_url": f"/api/audio/{audio_path.name}",
                }
            )
        except Exception as exc:
            log_exception("tts.segment", exc)
            audio_queue.put({"event": "audio_error", "text": segment, "message": str(exc)})

    executor.submit(worker)


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
    return result


@app.post("/api/gsv/stop")
def stop_gsv():
    return stop_gsv_api()


@app.post("/api/gsv/apply-models")
def apply_models(payload: SettingsPayload | None = None):
    settings = save_settings(payload.settings) if payload else load_settings()
    try:
        apply_gsv_models(settings, force=True)
    except Exception as exc:
        log_exception("gsv.apply_models", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


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
        audio_queue: queue.Queue = queue.Queue()
        pending_segments = 0

        yield _stream_event("start", {"user_text": user_text})
        with ThreadPoolExecutor(max_workers=1) as executor:
            try:
                for delta in stream_chat_completion(settings, user_text, payload.history):
                    assistant_text += delta
                    tts_buffer += delta
                    yield _stream_event("text_delta", {"delta": delta})

                    while True:
                        segment, tts_buffer = _pop_tts_segment(tts_buffer)
                        if segment is None:
                            break
                        if payload.speak:
                            pending_segments += 1
                            _submit_tts(executor, audio_queue, settings, segment)

                    for item in _iter_completed_audio(audio_queue):
                        if item.get("event") in {"audio", "audio_error"}:
                            pending_segments = max(0, pending_segments - 1)
                        yield _stream_event(item.pop("event"), item)

                segment, tts_buffer = _pop_tts_segment(tts_buffer, final=True)
                if segment and payload.speak:
                    pending_segments += 1
                    _submit_tts(executor, audio_queue, settings, segment)

                while pending_segments > 0:
                    item = audio_queue.get()
                    if item.get("event") in {"audio", "audio_error"}:
                        pending_segments = max(0, pending_segments - 1)
                    yield _stream_event(item.pop("event"), item)

                yield _stream_event("done", {"assistant_text": assistant_text})
            except Exception as exc:
                log_exception("chat.stream", exc)
                yield _stream_event("error", {"message": str(exc)})

    return StreamingResponse(generate(), media_type="application/x-ndjson")


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
