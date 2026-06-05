from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, NamedTuple

import requests


ROOT_DIR = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT_DIR / "runtime" / "outputs"

class SynthesizedAudio(NamedTuple):
    content: bytes
    media_type: str


def _base_url(settings: dict[str, Any]) -> str:
    return (settings.get("gsv_api_url") or "http://127.0.0.1:9880").rstrip("/")


def check_gsv_api(settings: dict[str, Any]) -> dict[str, Any]:
    base = _base_url(settings)
    try:
        response = requests.get(f"{base}/control", timeout=3)
    except requests.RequestException as exc:
        return {"ok": False, "url": base, "error": str(exc)}

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if response.status_code == 400 and payload.get("message") == "command is required":
        return {"ok": True, "url": base, "status_code": response.status_code, "service": "GPT-SoVITS API"}

    return {
        "ok": False,
        "url": base,
        "status_code": response.status_code,
        "message": payload.get("message") if isinstance(payload, dict) else response.text[:200],
    }


def sanitize_tts_text(text: str) -> str:
    """Normalize text for TTS without changing user-visible chat content."""
    return (text or "").strip()


def synthesize_bytes(settings: dict[str, Any], text: str) -> SynthesizedAudio:
    ref_audio_path = (settings.get("ref_audio_path") or "").strip()
    prompt_lang = (settings.get("prompt_lang") or "").strip()
    text_lang = (settings.get("text_lang") or "").strip()
    if not ref_audio_path:
        raise ValueError("请先在 GSV 设置中填写参考音频路径")
    if not prompt_lang or not text_lang:
        raise ValueError("请先填写参考音频语种和输出文本语种")

    text = sanitize_tts_text(text)
    if not text:
        raise ValueError("清洗后没有可用于语音合成的文本")

    aux_paths = [
        item.strip()
        for item in (settings.get("aux_ref_audio_paths") or "").splitlines()
        if item.strip()
    ]
    payload = {
        "text": text,
        "text_lang": text_lang,
        "ref_audio_path": ref_audio_path,
        "aux_ref_audio_paths": aux_paths,
        "prompt_text": settings.get("prompt_text") or "",
        "prompt_lang": prompt_lang,
        "top_k": int(settings.get("top_k") or 15),
        "top_p": float(settings.get("top_p") or 1.0),
        "temperature": float(settings.get("tts_temperature") or 1.0),
        "text_split_method": settings.get("text_split_method") or "cut5",
        "batch_size": 1,
        "speed_factor": float(settings.get("speed_factor") or 1.0),
        "media_type": settings.get("media_type") or "wav",
        "streaming_mode": int(settings.get("streaming_mode") or 0),
        "parallel_infer": True,
    }

    response = requests.post(f"{_base_url(settings)}/tts", json=payload, timeout=240)
    content_type = response.headers.get("content-type", "")
    if response.status_code >= 400 or "application/json" in content_type:
        raise RuntimeError(f"GSV 语音合成失败：{response.text}")

    media_type = payload["media_type"]
    return SynthesizedAudio(content=response.content, media_type=media_type)


def synthesize(settings: dict[str, Any], text: str) -> Path:
    audio = synthesize_bytes(settings, text)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{uuid.uuid4().hex}.{audio.media_type}"
    output_path.write_bytes(audio.content)
    return output_path
