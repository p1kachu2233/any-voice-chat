from __future__ import annotations

import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.gsv_client import check_gsv_api
from app.settings import ROOT_DIR


GSV_DIR = ROOT_DIR / "GPT-SoVITS"
RUNTIME_DIR = ROOT_DIR / "runtime"
GSV_LOG_PATH = RUNTIME_DIR / "gsv_api.log"
DEFAULT_TTS_CONFIG = "GPT_SoVITS/configs/tts_infer.yaml"

_process_lock = threading.Lock()
_process: subprocess.Popen | None = None


def _parse_local_endpoint(settings: dict[str, Any]) -> tuple[str, int]:
    url = settings.get("gsv_api_url") or "http://127.0.0.1:9880"
    parsed = urlparse(url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 9880
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("只能从本机启动 GSV API；远程 GSV 地址请手动启动后填写 URL")
    return "127.0.0.1", port


def _is_owned_process_running() -> bool:
    return _process is not None and _process.poll() is None


def start_gsv_api(settings: dict[str, Any]) -> dict[str, Any]:
    global _process

    with _process_lock:
        health = check_gsv_api(settings)
        if health.get("ok"):
            return {"ok": True, "already_running": True, "health": health}

        if _is_owned_process_running():
            return {"ok": True, "already_running": True, "pid": _process.pid, "health": health}

        host, port = _parse_local_endpoint(settings)
        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        log_file = GSV_LOG_PATH.open("a", encoding="utf-8")
        log_file.write("\n\n=== Starting GPT-SoVITS API ===\n")
        log_file.flush()

        command = [
            sys.executable,
            "api_v2.py",
            "-a",
            host,
            "-p",
            str(port),
            "-c",
            DEFAULT_TTS_CONFIG,
        ]
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
        _process = subprocess.Popen(
            command,
            cwd=GSV_DIR,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            creationflags=creationflags,
        )

    for _ in range(120):
        time.sleep(1)
        health = check_gsv_api(settings)
        if health.get("ok"):
            return {"ok": True, "pid": _process.pid if _process else None, "health": health}
        if _process and _process.poll() is not None:
            break

    return {
        "ok": False,
        "pid": _process.pid if _process else None,
        "health": check_gsv_api(settings),
        "log_path": str(GSV_LOG_PATH),
    }


def stop_gsv_api() -> dict[str, Any]:
    global _process

    with _process_lock:
        if not _is_owned_process_running():
            _process = None
            return {"ok": True, "stopped": False}

        pid = _process.pid
        _process.terminate()
        try:
            _process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            _process.kill()
            _process.wait(timeout=15)
        _process = None
        return {"ok": True, "stopped": True, "pid": pid}


def gsv_process_status(settings: dict[str, Any]) -> dict[str, Any]:
    process_running = _is_owned_process_running()
    return {
        "owned_process_running": process_running,
        "pid": _process.pid if process_running and _process else None,
        "health": check_gsv_api(settings),
        "log_path": str(GSV_LOG_PATH),
    }
