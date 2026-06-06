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
    "enable_gsv_tts": True,
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
    "tts_min_segment_chars": 10,
    "tts_soft_segment_chars": 60,
    "tts_force_segment_chars": 90,
    "text_display_mode": "speech_sync",
    "vad_threshold": 0.055,
    "vad_noise_multiplier": 3.2,
    "vad_noise_offset": 0.025,
    "vad_assistant_threshold": 0.095,
    "vad_assistant_noise_multiplier": 5.2,
    "vad_assistant_noise_offset": 0.052,
    "vad_start_frames": 6,
    "vad_silence_ms": 1000,
    "vad_min_speech_ms": 500,
    "vad_cooldown_ms": 900,
    "vad_pre_buffer_ms": 500,
    "vad_engine": "vad_web",
}

_settings_lock = threading.Lock()
DEFAULT_IF_EMPTY_KEYS = {"ref_audio_path", "prompt_text", "prompt_lang", "text_lang"}
VALID_TEXT_SPLIT_METHODS = {"cut0", "cut1", "cut2", "cut3", "cut4", "cut5"}
VALID_TEXT_DISPLAY_MODES = {"speech_sync", "text_first"}
VALID_VAD_ENGINES = {"vad_web", "rms"}


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
    if settings["text_split_method"] not in VALID_TEXT_SPLIT_METHODS:
        settings["text_split_method"] = DEFAULT_SETTINGS["text_split_method"]
    settings["tts_min_segment_chars"] = min(max(settings["tts_min_segment_chars"], 1), 80)
    settings["tts_soft_segment_chars"] = min(max(settings["tts_soft_segment_chars"], 0), 500)
    settings["tts_force_segment_chars"] = min(max(settings["tts_force_segment_chars"], 0), 1000)
    settings["vad_threshold"] = min(max(settings["vad_threshold"], 0.001), 0.3)
    settings["vad_noise_multiplier"] = min(max(settings["vad_noise_multiplier"], 1.0), 10.0)
    settings["vad_noise_offset"] = min(max(settings["vad_noise_offset"], 0.0), 0.3)
    settings["vad_assistant_threshold"] = min(max(settings["vad_assistant_threshold"], 0.001), 0.5)
    settings["vad_assistant_noise_multiplier"] = min(max(settings["vad_assistant_noise_multiplier"], 1.0), 15.0)
    settings["vad_assistant_noise_offset"] = min(max(settings["vad_assistant_noise_offset"], 0.0), 0.5)
    settings["vad_start_frames"] = min(max(settings["vad_start_frames"], 1), 30)
    settings["vad_silence_ms"] = min(max(settings["vad_silence_ms"], 200), 5000)
    settings["vad_min_speech_ms"] = min(max(settings["vad_min_speech_ms"], 100), 3000)
    settings["vad_cooldown_ms"] = min(max(settings["vad_cooldown_ms"], 0), 5000)
    settings["vad_pre_buffer_ms"] = min(max(settings["vad_pre_buffer_ms"], 0), 2000)
    if settings["vad_engine"] not in VALID_VAD_ENGINES:
        settings["vad_engine"] = DEFAULT_SETTINGS["vad_engine"]
    if settings["text_display_mode"] not in VALID_TEXT_DISPLAY_MODES:
        settings["text_display_mode"] = DEFAULT_SETTINGS["text_display_mode"]
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
