#!/usr/bin/env python3
"""
Gemini 呼叫的共用层
--------------------
两支脚本（拍题录入、依考纲出题）都要打 Gemini，把「选模型」与「错误讯息」
集中在这里，理由是踩过一次坑：写死的 gemini-1.5-flash 被 Google 淘汰之后，
两支脚本会同时静默失败，而且当时看不出原因。

所以这里做两件事：
1. 不写死模型 —— 先问 Google 现在有哪些模型可用，再按偏好顺序挑一个
2. 失败时把 API 回传的实际错误讯息抓出来，而不是只丢一句「呼叫失败」
"""

import json
import os
import sys
import urllib.error
import urllib.request

API_BASE = "https://generativelanguage.googleapis.com/v1beta"

# 偏好顺序：够快够便宜、而且支援图片输入。清单里没有的就往下找。
PREFERRED = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-pro",
]

_resolved = None


class GeminiError(Exception):
    """带着 API 实际回应的错误，方便在报告里显示到底哪里不对。"""


def _read_error(e):
    if isinstance(e, urllib.error.HTTPError):
        try:
            body = json.loads(e.read().decode("utf-8"))
            msg = body.get("error", {}).get("message", "")
            return f"HTTP {e.code}：{msg or e.reason}"
        except Exception:
            return f"HTTP {e.code}：{e.reason}"
    return str(e)


def list_models(api_key):
    req = urllib.request.Request(f"{API_BASE}/models?key={api_key}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    out = []
    for m in data.get("models", []):
        if "generateContent" in (m.get("supportedGenerationMethods") or []):
            out.append(m.get("name", "").replace("models/", ""))
    return out


def resolve_model(api_key):
    """GEMINI_MODEL 有指定就用指定的；否则问 Google 现在有什么，按偏好挑。"""
    global _resolved
    if _resolved:
        return _resolved

    forced = os.environ.get("GEMINI_MODEL", "").strip()
    if forced:
        _resolved = forced
        return _resolved

    try:
        available = list_models(api_key)
    except (urllib.error.URLError, ValueError) as e:
        raise GeminiError(f"无法取得模型清单：{_read_error(e)}")

    if not available:
        raise GeminiError("这把 API Key 没有任何可用的模型，请确认金钥是否有效、专案是否已启用 Gemini API。")

    for name in PREFERRED:
        if name in available:
            _resolved = name
            break
    else:
        # 偏好清单全没中，就挑一个名字里有 flash 的，再不然用第一个
        _resolved = next((m for m in available if "flash" in m), available[0])

    print(f"🤖 使用模型：{_resolved}", file=sys.stderr)
    return _resolved


def generate(api_key, parts, temperature=0.4, timeout=120):
    """parts 是 Gemini 的 contents[0].parts，文字或图片都塞这里。"""
    model = resolve_model(api_key)
    payload = {"contents": [{"parts": parts}], "generationConfig": {"temperature": temperature}}
    req = urllib.request.Request(
        f"{API_BASE}/models/{model}:generateContent?key={api_key}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, ValueError) as e:
        raise GeminiError(_read_error(e))

    candidates = result.get("candidates") or []
    if not candidates:
        reason = (result.get("promptFeedback") or {}).get("blockReason", "")
        raise GeminiError(f"模型没有回传内容{'（被挡下：' + reason + '）' if reason else ''}")
    try:
        return candidates[0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        finish = candidates[0].get("finishReason", "")
        raise GeminiError(f"回应格式不如预期（finishReason={finish or '未知'}）")
