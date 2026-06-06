from __future__ import annotations

import os
import subprocess
import sys
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path

import numpy as np


ROOT_DIR = Path(__file__).resolve().parents[1]
GSV_DIR = ROOT_DIR / "GPT-SoVITS"
UPLOAD_DIR = ROOT_DIR / "runtime" / "uploads"

_asr_lock = threading.Lock()
_asr_cancel_lock = threading.Lock()
_cancelled_asr_ids: set[str] = set()
_asr_models = {}


@contextmanager
def gsv_context():
    previous_cwd = Path.cwd()
    gsv_path = str(GSV_DIR)
    inserted = False
    if gsv_path not in sys.path:
        sys.path.insert(0, gsv_path)
        inserted = True
    os.chdir(GSV_DIR)
    try:
        yield
    finally:
        os.chdir(previous_cwd)
        if inserted:
            try:
                sys.path.remove(gsv_path)
            except ValueError:
                pass


def _suffix_from_name(filename: str | None) -> str:
    if not filename:
        return ".webm"
    suffix = Path(filename).suffix.lower()
    return suffix if suffix else ".webm"


def save_upload(data: bytes, filename: str | None) -> Path:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    raw_path = UPLOAD_DIR / f"{uuid.uuid4().hex}{_suffix_from_name(filename)}"
    raw_path.write_bytes(data)
    return raw_path


def convert_to_wav(input_path: Path) -> Path:
    wav_path = input_path.with_suffix(".wav")
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-ac",
        "1",
        "-ar",
        "16000",
        str(wav_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffmpeg audio conversion failed")
    return wav_path


def decode_audio_bytes(data: bytes) -> np.ndarray:
    if not data or len(data) < 128:
        return np.array([], dtype=np.float32)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "s16le",
        "pipe:1",
    ]
    result = subprocess.run(cmd, input=data, capture_output=True)
    if result.returncode != 0:
        error = result.stderr.decode("utf-8", errors="replace").strip()
        if "Invalid data found when processing input" in error or "Error opening input file pipe:0" in error:
            return np.array([], dtype=np.float32)
        raise RuntimeError(error or "ffmpeg audio decode failed")
    if not result.stdout:
        return np.array([], dtype=np.float32)
    return np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def cancel_asr(asr_id: str) -> None:
    with _asr_cancel_lock:
        _cancelled_asr_ids.add(asr_id)


def _is_asr_cancelled(asr_id: str | None) -> bool:
    if not asr_id:
        return False
    with _asr_cancel_lock:
        return asr_id in _cancelled_asr_ids


def _finish_asr(asr_id: str | None) -> None:
    if not asr_id:
        return
    with _asr_cancel_lock:
        _cancelled_asr_ids.discard(asr_id)


def _load_asr_model(language: str):
    with gsv_context():
        from tools.asr.funasr_asr import create_model

        if language not in _asr_models:
            _asr_models[language] = create_model(language)
        return _asr_models[language]


def warmup_asr(language: str = "zh") -> None:
    language = _normalize_language(language)
    with _asr_lock:
        _load_asr_model(language)


def _normalize_language(language: str) -> str:
    language = language or "zh"
    return language if language in {"zh", "yue"} else "zh"


def transcribe_audio_bytes(data: bytes, language: str = "zh", asr_id: str | None = None) -> str:
    language = _normalize_language(language)
    try:
        if _is_asr_cancelled(asr_id):
            return ""
        audio = decode_audio_bytes(data)
        if audio.size == 0 or _is_asr_cancelled(asr_id):
            return ""

        with _asr_lock:
            if _is_asr_cancelled(asr_id):
                return ""
            with gsv_context():
                model = _load_asr_model(language)
                result = model.generate(input=audio, fs=16000, disable_pbar=True)

        if _is_asr_cancelled(asr_id):
            return ""
        return (result[0].get("text") or "").strip()
    except (IndexError, AttributeError, TypeError):
        return ""
    finally:
        _finish_asr(asr_id)


def transcribe_audio(audio_path: Path, language: str = "zh") -> str:
    language = _normalize_language(language)

    with _asr_lock:
        with gsv_context():
            from tools.asr.funasr_asr import only_asr

            text = only_asr(str(audio_path), language)
    return (text or "").strip()
