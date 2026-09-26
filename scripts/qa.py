#!/usr/bin/env python3
"""
审题：录题与出题共用的自动检查
------------------------------
每一项检查不通过，就往题目的 flags 里加一句说明。/dev 只把「有 flags」的题展开给你看、
让你改；flags 是空的题收在「一键采纳」清单里。所以这里的检查漏掉什么，你就少看到什么 ——
宁可多标，不要少标。

  1. text_problems   题干/选项夹英文虚词（「甘油 and 脂肪酸」）、残留转写标记、题号没去掉
  2. source_drift    Word/PPT/文字档：题干与选项要能在原档里一字不差找到，
                     AI 改字、加字、漏字（例如漏掉「不」）都标出来，并写出原档与录入的差异
  3. cross_check     请 Gemini 在看不到答案的情况下重做一次选择题，和已有答案比对
"""

import difflib
import json
import re
import unicodedata

import gemini_api

SUBJECT_LABEL = {"biology": "生物", "chemistry": "化学", "physics": "物理"}
LETTERS = "ABCD"

CJK = re.compile(r"[一-鿿]")
ENGLISH_FILLER = re.compile(r"(?<![A-Za-z])(and|or|the|of|is|are|not|which|with|what)(?![A-Za-z])", re.I)
LEFTOVER_MARK = re.compile(r"\[/?标记[^\]]*\]|\[图\d+\]")
LEADING_NUMBER = re.compile(r"^\s*(\d{1,3}|[（(]\d{1,3}[)）])\s*[.．、)]")
# 同一行里先有「I 叙述」再有「II」：罗马数字叙述没有各占一行（物理的电流 I 不会接著出现 II）
ROMAN_ONE_LINE = re.compile(r"(?<![A-Za-z])I\s+\S.*?\sII(?![A-Za-z])")


def extract_json_array(text):
    cleaned = re.sub(r"^```(json)?|```$", "", text.strip(), flags=re.M).strip()
    data = json.loads(cleaned)
    if not isinstance(data, list):
        raise json.JSONDecodeError("不是 JSON 数组", cleaned, 0)
    return data


def _stem(record):
    return record.get("q") or record.get("question") or ""


def _option_body(opt):
    return re.sub(r"^\s*[A-D][.．]\s*", "", str(opt))


def text_problems(record):
    """只看题目本身就知道有问题的地方"""
    out = []
    pieces = [("题干", _stem(record))] + [(f"选项{LETTERS[i]}", o) for i, o in enumerate(record.get("options") or [])]
    for label, text in pieces:
        text = str(text)
        if CJK.search(text):
            m = ENGLISH_FILLER.search(text)
            if m:
                out.append(f"{label}夹了英文「{m.group(0)}」，疑似转写错误")
        if LEFTOVER_MARK.search(text):
            out.append(f"{label}残留转写标记「{LEFTOVER_MARK.search(text).group(0)}」")
    if LEADING_NUMBER.match(_stem(record)):
        out.append("题干开头的题号没去掉")
    if any(ROMAN_ONE_LINE.search(line) for line in _stem(record).splitlines()):
        out.append("题干的罗马数字叙述（I、II…）挤在同一行，请每项换行")
    return out


# ---------- 与原档比对 ----------

def canon(text):
    """比对用：去掉转写标记，全形/上下标/罗马数字统一（NFKC），只留字母、数字、汉字"""
    text = LEFTOVER_MARK.sub("", str(text or ""))
    text = unicodedata.normalize("NFKC", text).lower()
    return "".join(ch for ch in text if ch.isalnum())


def _drift(piece, source):
    """piece 在原档里一字不差找得到就回 None；否则回传差异说明"""
    a = canon(piece)
    if len(a) < 2 or a in source:
        return None
    i, j, k = difflib.SequenceMatcher(None, a, source, autojunk=False).find_longest_match(0, len(a), 0, len(source))
    if k < max(3, len(a) // 4):
        return "原档里找不到这段文字"
    start = max(0, j - i - 5)
    window = source[start:j - i + len(a) + 5]
    matcher = difflib.SequenceMatcher(None, a, window, autojunk=False)
    if matcher.ratio() < 0.7:
        return "原档里找不到这段文字（可能被 AI 改写了）"
    diffs = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag == "insert" and (i1 == 0 or i1 == len(a)):
            continue   # 原档在这段前後多出来的字（题号、下一题）不算
        diffs.append(f"原档「{window[j1:j2] or '（无）'}」→ 录入「{a[i1:i2] or '（漏掉）'}」")
    return "；".join(diffs[:3]) if diffs else None


def source_drift(record, source):
    """source 是 canon() 过的原档全文；Word/PPT/文字档才有，照片与 PDF 没有原文可比"""
    out = []
    pieces = [("题干", _stem(record))] + [(f"选项{LETTERS[i]}", _option_body(o))
                                        for i, o in enumerate(record.get("options") or [])]
    for label, text in pieces:
        why = _drift(text, source)
        if why:
            out.append(f"⚠️ {label}和原档不一致：{why}")
    return out


# ---------- 答案复核 ----------

def build_check_prompt(subject, mcqs):
    lines = []
    for i, q in enumerate(mcqs, 1):
        lines.append(f"第 {i} 题：{q['q']}\n" + "\n".join(q["options"]))
    return f"""你是 UEC 高中统考{SUBJECT_LABEL.get(subject, subject)}科阅卷老师。请独立作答下列选择题（不要参考任何其他资料上的答案），
只回传 JSON 数组，每题一项：{{"n": 题号, "answer": 0-3 的下标（0=A…3=D）, "reason": "一句话理由"}}

""" + "\n\n".join(lines)


def cross_check(api_key, subject, records, report_notes):
    """Gemini 不看答案再做一次选择题。失败不挡录题，只把每题标成「未复核」"""
    mcqs = [r for r in records if r["type"] == "mcq"]
    if not mcqs:
        return
    try:
        answers = extract_json_array(gemini_api.generate(api_key, [{"text": build_check_prompt(subject, mcqs)}], temperature=0))
    except (gemini_api.GeminiError, json.JSONDecodeError) as e:
        report_notes.append(f"答案复核没跑成（{str(e)[:60]}），这批的答案请全部人工核对")
        for r in mcqs:
            r["flags"].append("答案未经 AI 复核")
        return
    by_n = {a.get("n"): a for a in answers if isinstance(a, dict)}
    for i, r in enumerate(mcqs, 1):
        got = by_n.get(i, {})
        second = got.get("answer")
        if not isinstance(second, int) or not 0 <= second <= 3:
            r["flags"].append("答案未经 AI 复核")
            continue
        r["review"] = {"ai_answer": second, "reason": str(got.get("reason", ""))[:120]}
        if second == r["answer"]:
            if r.get("answer_source") == "ai":
                r["flags"].append("原档没标答案，由 AI 作答（两次一致），仍请核对")
            continue
        who = {"marked": "原档标的", "generated": "出题时给的"}.get(r.get("answer_source"), "AI 第一次作答")
        r["flags"].append(f"⚠️ 答案有疑：{who}是 {LETTERS[r['answer']]}，AI 复核选 {LETTERS[second]}"
                          f"（{r['review']['reason'] or '无理由'}），请核对")
