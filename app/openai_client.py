from __future__ import annotations

from typing import Any

import requests


def _build_url(base_url: str) -> str:
    base = (base_url or "https://api.openai.com/v1").rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def chat_completion(settings: dict[str, Any], user_text: str, history: list[dict[str, str]] | None = None) -> str:
    api_key = (settings.get("openai_api_key") or "").strip()
    if not api_key:
        raise ValueError("请先在设置中填写 OpenAI API Key")

    messages: list[dict[str, str]] = []
    system_prompt = (settings.get("system_prompt") or "").strip()
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    for item in history or []:
        role = item.get("role")
        content = (item.get("content") or "").strip()
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": user_text})

    payload = {
        "model": settings.get("openai_model") or "gpt-4o-mini",
        "messages": messages,
        "temperature": float(settings.get("openai_temperature") or 0.7),
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    response = requests.post(_build_url(settings.get("openai_base_url", "")), headers=headers, json=payload, timeout=90)
    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text
        raise RuntimeError(f"OpenAI 请求失败：{detail}")

    data = response.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        raise RuntimeError(f"OpenAI 返回格式异常：{data}")
