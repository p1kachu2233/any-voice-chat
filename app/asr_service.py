from __future__ import annotations

import os
import subprocess
import sys
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
GSV_DIR = ROOT_DIR / "GPT-SoVITS"
UPLOAD_DIR = ROOT_DIR / "runtime" / "uploads"

_asr_lock = threading.Lock()


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


def transcribe_audio(audio_path: Path, language: str = "zh") -> str:
    language = language or "zh"
    if language not in {"zh", "yue"}:
        language = "zh"

    with _asr_lock:
        with gsv_context():
            from tools.asr.funasr_asr import only_asr

            text = only_asr(str(audio_path), language)
    return (text or "").strip()
