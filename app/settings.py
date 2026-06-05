from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
SETTINGS_PATH = ROOT_DIR / "config" / "user_settings.json"


DEFAULT_SETTINGS: dict[str, Any] = {
    "openai_api_key": "",
    "openai_base_url": "https://api.openai.com/v1",
    "openai_model": "gpt-4o-mini",
    "openai_temperature": 0.7,
    "system_prompt": "你是一个适合语音聊天的助手。回答要自然、简洁，像真人对话一样。",
    "asr_language": "zh",
    "gsv_api_url": "http://127.0.0.1:9880",
    "gsv_version": "v2",
    "gsv_device": "cuda",
    "gsv_is_half": True,
    "gpt_weights_path": "",
    "sovits_weights_path": "",
    "ref_audio_path": r"D:\jjy_cut\cut_1_voice\mp4_360P_xtdowner.com_新华社采访完整版，鞠婧祎：“我不太能够接受原地踏步，我需要学习，需要汲取更多的能量，在这个过程中，我一定会成为更好的人”-00.00.16.577-00.00.19.288-seg01_Vocals.wav",
    "aux_ref_audio_paths": "",
    "prompt_text": "新华社的朋友们大家好，我是鞠婧祎",
    "prompt_lang": "zh",
    "text_lang": "zh",
    "text_split_method": "cut5",
    "top_k": 15,
    "top_p": 1.0,
    "tts_temperature": 1.0,
    "speed_factor": 1.0,
    "media_type": "wav",
    "streaming_mode": 1,
}

_settings_lock = threading.Lock()
DEFAULT_IF_EMPTY_KEYS = {"ref_audio_path", "prompt_text", "prompt_lang", "text_lang"}


def _coerce_value(key: str, value: Any) -> Any:
    default = DEFAULT_SETTINGS[key]
    if isinstance(default, bool):
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)
    if isinstance(default, int) and not isinstance(default, bool):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default
    if isinstance(default, float):
        try:
            return float(value)
        except (TypeError, ValueError):
            return default
    if value is None:
        return ""
    return str(value)


def normalize_settings(values: dict[str, Any]) -> dict[str, Any]:
    settings = DEFAULT_SETTINGS.copy()
    for key in DEFAULT_SETTINGS:
        if key in values:
            settings[key] = _coerce_value(key, values[key])
        if key in DEFAULT_IF_EMPTY_KEYS and settings[key] == "":
            settings[key] = DEFAULT_SETTINGS[key]
    return settings


def load_settings() -> dict[str, Any]:
    with _settings_lock:
        if not SETTINGS_PATH.exists():
            return DEFAULT_SETTINGS.copy()
        try:
            data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return DEFAULT_SETTINGS.copy()
        return normalize_settings(data)


def save_settings(values: dict[str, Any]) -> dict[str, Any]:
    settings = normalize_settings(values)
    with _settings_lock:
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_PATH.write_text(
            json.dumps(settings, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    return settings
