from __future__ import annotations

import subprocess
import sys
import threading
import time
import os
import requests
import yaml
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.gsv_client import check_gsv_api
from app.settings import ROOT_DIR


GSV_DIR = ROOT_DIR / "GPT-SoVITS"
RUNTIME_DIR = ROOT_DIR / "runtime"
GSV_LOG_PATH = RUNTIME_DIR / "gsv_api.log"
DEFAULT_TTS_CONFIG = "GPT_SoVITS/configs/tts_infer.yaml"
RUNTIME_TTS_CONFIG = RUNTIME_DIR / "tts_infer_runtime.yaml"
VALID_GSV_VERSIONS = {"v1", "v2", "v2Pro", "v2ProPlus", "v3", "v4"}
VALID_GSV_DEVICES = {"cuda", "cpu"}

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


def prepare_tts_config(settings: dict[str, Any]) -> dict[str, Any]:
    source_path = GSV_DIR / DEFAULT_TTS_CONFIG
    version = settings.get("gsv_version") or "v2"
    if version not in VALID_GSV_VERSIONS:
        raise ValueError(f"GSV 版本不支持：{version}")
    device = settings.get("gsv_device") or "cuda"
    if device not in VALID_GSV_DEVICES:
        raise ValueError(f"GSV Device 不支持：{device}")
    if not source_path.exists():
        raise FileNotFoundError(f"TTS 配置文件不存在：{source_path}")

    with source_path.open("r", encoding="utf-8") as file:
        config_data = yaml.safe_load(file) or {}

    if version not in config_data:
        raise ValueError(f"TTS 配置文件中没有版本示例：{version}")

    selected = dict(config_data.get("custom") or {})
    version_defaults = dict(config_data[version] or {})
    selected["version"] = version
    selected["device"] = device
    selected["is_half"] = bool(settings.get("gsv_is_half"))
    selected["t2s_weights_path"] = version_defaults.get("t2s_weights_path", selected.get("t2s_weights_path", ""))
    selected["vits_weights_path"] = version_defaults.get("vits_weights_path", selected.get("vits_weights_path", ""))

    gpt_path = (settings.get("gpt_weights_path") or "").strip()
    sovits_path = (settings.get("sovits_weights_path") or "").strip()
    if gpt_path:
        selected["t2s_weights_path"] = gpt_path
    if sovits_path:
        selected["vits_weights_path"] = sovits_path

    config_data = {"custom": selected}
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with RUNTIME_TTS_CONFIG.open("w", encoding="utf-8") as file:
        yaml.safe_dump(config_data, file, allow_unicode=True, sort_keys=False)

    return {
        "source_path": str(source_path),
        "runtime_path": str(RUNTIME_TTS_CONFIG),
        "section": "custom",
        "version": selected.get("version"),
        "device": selected.get("device"),
        "is_half": selected.get("is_half"),
        "t2s_weights_path": selected.get("t2s_weights_path"),
        "vits_weights_path": selected.get("vits_weights_path"),
    }


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
        tts_config = prepare_tts_config(settings)
        log_file = GSV_LOG_PATH.open("a", encoding="utf-8")
        log_file.write("\n\n=== Starting GPT-SoVITS API ===\n")
        log_file.write(f"TTS config: {tts_config}\n")
        log_file.flush()

        command = [
            sys.executable,
            "api_v2.py",
            "-a",
            host,
            "-p",
            str(port),
            "-c",
            str(RUNTIME_TTS_CONFIG),
        ]
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        _process = subprocess.Popen(
            command,
            cwd=GSV_DIR,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            creationflags=creationflags,
            env=env,
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


def _base_url(settings: dict[str, Any]) -> str:
    return (settings.get("gsv_api_url") or "http://127.0.0.1:9880").rstrip("/")


def stop_gsv_api(settings: dict[str, Any] | None = None) -> dict[str, Any]:
    global _process

    with _process_lock:
        if not _is_owned_process_running():
            _process = None
            if settings and check_gsv_api(settings).get("ok"):
                try:
                    requests.get(f"{_base_url(settings)}/control", params={"command": "exit"}, timeout=5)
                    return {"ok": True, "stopped": True, "via_control": True}
                except requests.RequestException as exc:
                    return {"ok": False, "stopped": False, "error": str(exc)}
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
