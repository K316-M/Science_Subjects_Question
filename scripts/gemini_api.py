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
import re
import sys
import time
import urllib.error
import urllib.request

API_BASE = "https://generativelanguage.googleapis.com/v1beta"

# 挑模型的顺序：版本新的优先（3.8 不行才到 3.7…），同一版本里 pro → flash → flash-lite，
# 正式版排在 preview/exp 前面。不写死型号 —— 每次都从 Google 的模型清单现排，
# 新模型上架就自动用上，旧模型下架也不会整条流水线跟着坏。
TIER_RANK = {"pro": 0, "flash": 1, "flash-lite": 2}
MODEL_RE = re.compile(r"^gemini-(\d+(?:\.\d+)?)-(pro|flash-lite|flash)(?:-(latest|\d{3}|preview[\w.-]*|exp[\w.-]*))?$")


def rank_models(names):
    """只留一般文字/图片用途的 gemini 模型（去掉 tts、image、embedding、live 等），按上面的顺序排好"""
    ranked = []
    for name in names:
        m = MODEL_RE.match(name)
        if not m:
            continue
        version, tier, suffix = m.groups()
        unstable = 1 if suffix and suffix.startswith(("preview", "exp")) else 0
        key = tuple(-int(n) for n in version.split("."))   # 用整数比，3.10 才会排在 3.9 前面
        ranked.append(((key, TIER_RANK[tier], unstable, name), name))
    return [name for _, name in sorted(ranked)]


_resolved = None
_available = None
_tried = []


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


def _catalogue(api_key):
    global _available
    if _available is None:
        try:
            _available = list_models(api_key)
        except (urllib.error.URLError, ValueError) as e:
            raise GeminiError(f"无法取得模型清单：{_read_error(e)}")
        if not _available:
            raise GeminiError("这把 API Key 没有任何可用的模型，请确认金钥是否有效、专案是否已启用 Gemini API。")
    return _available


def _next_candidate(api_key):
    """从清单里挑一个还没试过的：最高级的优先。"""
    return next((m for m in rank_models(_catalogue(api_key)) if m not in _tried), None)


def _suggested_model(message):
    """Google 被拒绝时会直接写「请改用 models/xxx」，把它读出来。"""
    names = re.findall(r"models/([A-Za-z0-9.\-]+)", message or "")
    for name in reversed(names):
        if name not in _tried:
            return name
    return None


def resolve_model(api_key):
    """GEMINI_MODEL 有指定就用指定的；否则问 Google 现在有什么，挑最高级的。"""
    global _resolved
    if _resolved:
        return _resolved

    forced = os.environ.get("GEMINI_MODEL", "").strip()
    _resolved = forced or _next_candidate(api_key)
    if not _resolved:
        raise GeminiError("找不到任何可用的模型。")
    print(f"🤖 使用模型：{_resolved}", file=sys.stderr)
    return _resolved


UNAVAILABLE = ("no longer available", "is not found", "not supported", "404")

# 临时性的：等一下再试就好，换模型也没意义（但同一个模型一直忙，最后才换）
TRANSIENT = ("high demand", "overloaded", "try again later", "temporarily",
             "internal error", "503", "500", "502", "504", "deadline exceeded", "timed out")
# 额度用尽：额度是按模型算的（pro 的免费额度最少），同一个模型重试没用，直接换下一个
QUOTA = ("exceeded your current quota", "quota exceeded", "billing", "resource_exhausted")

BACKOFF = (4, 10, 25)   # 秒


def generate(api_key, parts, temperature=0.4, timeout=300):
    """parts 是 Gemini 的 contents[0].parts，文字或图片都塞这里。

    从最高级的模型开始：下架、额度用完、一直忙，就往下一级换。
    Google 的错误讯息若写了建议替代就照它的，否则按 rank_models 的顺序走。
    """
    global _resolved
    last = None

    for _ in range(8):                       # 最多换 8 个模型（pro 额度用完、尖峰时段常常连着好几个都不行）
        model = resolve_model(api_key)

        for attempt, wait in enumerate((0,) + BACKOFF):
            if wait:
                print(f"⏳ {model} 忙碌中，{wait} 秒后重试（第 {attempt} 次）", file=sys.stderr)
                time.sleep(wait)
            try:
                return _post(api_key, model, parts, temperature, timeout)
            except GeminiError as e:
                last = e
                low = str(e).lower()
                if any(k in low for k in QUOTA):
                    break                    # 这个模型额度用完：重试没用，换下一个
                if any(k in low for k in TRANSIENT):
                    continue                 # 临时忙碌：等一下再打同一个模型
                break                        # 其他错误：跳出去判断要不要换模型

        low = str(last).lower()
        if not any(k in low for k in UNAVAILABLE + TRANSIENT + QUOTA):
            raise last                       # 不是模型层面的问题，换了也一样
        _tried.append(model)
        nxt = _suggested_model(str(last)) or _next_candidate(api_key)
        if not nxt:
            raise last
        print(f"⚠️ {model} 不行（{str(last)[:60]}），改试 {nxt}", file=sys.stderr)
        _resolved = nxt

    raise last or GeminiError("换过几个模型都不可用。")


def _post(api_key, model, parts, temperature, timeout):
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
