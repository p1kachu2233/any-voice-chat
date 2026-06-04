from __future__ import annotations

import threading
import uuid
import re
from pathlib import Path
from typing import Any

import requests


ROOT_DIR = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT_DIR / "runtime" / "outputs"

_model_lock = threading.Lock()
_last_applied: dict[str, str] = {"gpt_weights_path": "", "sovits_weights_path": ""}
_space_re = re.compile(r"\s+")


def _base_url(settings: dict[str, Any]) -> str:
    return (settings.get("gsv_api_url") or "http://127.0.0.1:9880").rstrip("/")


def check_gsv_api(settings: dict[str, Any]) -> dict[str, Any]:
    try:
        response = requests.get(f"{_base_url(settings)}/docs", timeout=3)
        return {"ok": response.status_code < 500, "status_code": response.status_code}
    except requests.RequestException as exc:
        return {"ok": False, "error": str(exc)}


def apply_gsv_models(settings: dict[str, Any], force: bool = False) -> None:
    with _model_lock:
        base = _base_url(settings)
        model_calls = [
            ("gpt_weights_path", "set_gpt_weights", "GPT"),
            ("sovits_weights_path", "set_sovits_weights", "SoVITS"),
        ]
        for key, endpoint, label in model_calls:
            path = (settings.get(key) or "").strip()
            if not path:
                continue
            if not force and _last_applied.get(key) == path:
                continue
            response = requests.get(f"{base}/{endpoint}", params={"weights_path": path}, timeout=180)
            if response.status_code >= 400:
                raise RuntimeError(f"{label} 模型切换失败：{response.text}")
            _last_applied[key] = path


def sanitize_tts_text(text: str) -> str:
    """Keep display text intact elsewhere, but remove chars that break GSV on GBK Windows consoles."""
    cleaned = (text or "").encode("gbk", errors="ignore").decode("gbk", errors="ignore")
    cleaned = _space_re.sub(" ", cleaned).strip()
    return cleaned


def synthesize(settings: dict[str, Any], text: str) -> Path:
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

    apply_gsv_models(settings)

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
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{uuid.uuid4().hex}.{media_type}"
    output_path.write_bytes(response.content)
    return output_path
