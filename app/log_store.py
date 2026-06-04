from __future__ import annotations

import json
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

from app.settings import ROOT_DIR


RUNTIME_DIR = ROOT_DIR / "runtime"
APP_LOG_PATH = RUNTIME_DIR / "app.log"
MAX_LOG_CHARS = 24000


def log_event(source: str, message: str, detail: Any = None, level: str = "error") -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "time": datetime.now().isoformat(timespec="seconds"),
        "level": level,
        "source": source,
        "message": str(message),
        "detail": detail,
    }
    with APP_LOG_PATH.open("a", encoding="utf-8") as file:
        file.write(json.dumps(payload, ensure_ascii=False) + "\n")


def log_exception(source: str, exc: Exception) -> None:
    log_event(source, str(exc), traceback.format_exc())


def read_tail(path: Path, max_chars: int = MAX_LOG_CHARS) -> str:
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) <= max_chars:
        return text
    return text[-max_chars:]
