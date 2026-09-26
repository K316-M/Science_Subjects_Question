#!/usr/bin/env python3
"""
AI 依考纲出题脚本
------------------
读取 papers/<subject>_question_bank.json 里的官方章节框架，挑出题目最少的章节，
请 Gemini 依据该章节（以及 syllabus/<subject>.md 里的官方考点，若有）撰写**原创**
选择题，写入 papers/pending_approval.json，并生成 GENERATION_REPORT.md 供人工审核。

与 ingest_drafts.py 的分工：
  - ingest_drafts.py  : 把你拍的真题照片转写成题目（来源是你自己的试卷）
  - generate_questions.py : 依考纲生成全新的练习题（来源是模型，必须人工核对）

⚠️ AI 写的理科题目可能科学性出错。本脚本产出的每一题都标记 needs_expert_check，
   一律只进待审区，必须由人审核合并后才会上线。每题都另请 Gemini 不看答案重做一次
   （qa.cross_check），答案对不上、文字有问题的才会被标出、在 /dev 展开要你逐题看。

运行需要 GEMINI_API_KEY；未配置时直接跳过。
"""

import datetime
import difflib
import json
import os
import re
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gemini_api
import qa

SUBJECTS = ["biology", "chemistry", "physics"]
SUBJECT_LABEL = {"biology": "生物", "chemistry": "化学", "physics": "物理"}
PAPERS_DIR = "papers"
SYLLABUS_DIR = "syllabus"
PENDING_PATH = os.path.join(PAPERS_DIR, "pending_approval.json")
REPORT_PATH = "GENERATION_REPORT.md"
STATUS_FLAG_PATH = "has_new_generated.txt"

API_KEY = os.environ.get("GEMINI_API_KEY")

# 每次运行出几题、照顾几个章节；可用环境变量覆盖，方便手动跑小批量试水
PER_CHAPTER = int(os.environ.get("QUESTIONS_PER_CHAPTER", "4"))
CHAPTERS_PER_RUN = int(os.environ.get("CHAPTERS_PER_RUN", "3"))
ONLY_SUBJECT = os.environ.get("ONLY_SUBJECT", "").strip()

SIMILARITY_LIMIT = 0.82   # 题干与既有题目相似度超过这个值就丢弃，避免换句话重复出题
SYLLABUS_CHAR_LIMIT = 12000   # 考纲塞进提示词的上限；三科目前都在这个数字以内，会整份带上


def load_bank(subject):
    path = os.path.join(PAPERS_DIR, f"{subject}_question_bank.json")
    if not os.path.exists(path):
        return {"sections": []}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        return {"sections": []}


def extract_pdf_text(path):
    try:
        import pypdf
    except ImportError:
        print(f"⚠️ 读取 PDF 考纲需要 pypdf（pip install pypdf）：{path}", file=sys.stderr)
        return ""
    try:
        reader = pypdf.PdfReader(path)
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
        return re.sub(r"\n{3,}", "\n\n", text).strip()
    except Exception as e:
        print(f"⚠️ 解析 PDF 考纲失败：{path} — {e}", file=sys.stderr)
        return ""


def load_syllabus(subject):
    """官方考纲：需要你自己把公开文件放进 syllabus/（董总网站拒绝程序抓取）。
    纯文字或 PDF 都收——很多人会把下载的 PDF 直接改名成 .md，所以这里看的是
    档案内容的前几个字节，而不是副档名。"""
    for ext in (".md", ".txt", ".pdf"):
        path = os.path.join(SYLLABUS_DIR, subject + ext)
        if not os.path.exists(path):
            continue
        with open(path, "rb") as f:
            if f.read(5).startswith(b"%PDF"):
                return extract_pdf_text(path)
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read().strip()
    return ""


def normalize(text):
    return re.sub(r"[\s，。、；：？！（）()\[\]<>“”\"'’·．.,;:?!-]+", "", str(text or ""))


def existing_stems(section):
    return [q.get("q", "") for q in section.get("mcqs", [])]


def too_similar(candidate, known_norms):
    cand = normalize(candidate)
    if not cand:
        return True
    for known in known_norms:
        if difflib.SequenceMatcher(None, cand, known).ratio() >= SIMILARITY_LIMIT:
            return True
    return False


def pick_chapters(bank):
    """题目最少的章节优先，数量相同则照原顺序，确保每周都轮到不同章节。"""
    sections = bank.get("sections", [])
    ranked = sorted(
        enumerate(sections),
        key=lambda pair: (len(pair[1].get("mcqs", []) or []), pair[0]),
    )
    return [sec for _, sec in ranked[:CHAPTERS_PER_RUN]]


def build_prompt(subject, section, syllabus):
    label = SUBJECT_LABEL.get(subject, subject)
    avoid = existing_stems(section)[:12]
    avoid_block = "\n".join(f"- {s[:60]}" for s in avoid) or "（本章目前没有题目）"
    syllabus_block = f"\n【官方考纲节录】\n{syllabus[:SYLLABUS_CHAR_LIMIT]}\n" if syllabus else ""

    return f"""你是马来西亚华文独立中学（董总 UEC 高中统考）{label}科的资深命题老师。
请为以下章节撰写 {PER_CHAPTER} 道**全新原创**的单选题。

【章节】{section.get('title', '')}
{syllabus_block}
【本章已有题目的题干（不可重复、不可改写同一题）】
{avoid_block}

硬性要求：
1. 必须是你自己撰写的原创题，**不得抄录任何教科书、试卷或题库的原题**。
2. 难度贴近统考高中程度，用词与符号遵循统考惯例，一律使用简体中文。
3. 每题恰好 4 个选项，以 "A. " "B. " "C. " "D. " 为前缀；answer 为正确选项下标（0=A,1=B,2=C,3=D）。
4. **绝对不可以出需要看图才能作答的题**（不得出现「如图」「下图」「图中」「如下表」等字眼），
   因为本系统目前无法为生成题配图。
5. explanation 要写出考点与推理过程，说明为什么正确选项对、并点出常见错误理解。
6. 四个选项中的错误选项要是「有道理的错」（常见迷思概念），不要明显凑数。

只返回一个 JSON 数组，不要包含 Markdown 代码块标记或任何额外说明文字。每项结构：
{{
  "q": "题干",
  "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
  "answer": 0,
  "explanation": "考点解析"
}}
"""


def call_gemini(prompt):
    return gemini_api.generate(API_KEY, [{"text": prompt}], temperature=0.7)


def extract_json_array(text):
    cleaned = re.sub(r"^```(json)?|```$", "", text.strip(), flags=re.M).strip()
    return json.loads(cleaned)


FIGURE_WORDS = ["如图", "下图", "上图", "图中", "图示", "如下表", "下表", "装置图", "示意图"]


def validate(entry):
    """返回 (是否可用, 问题说明)。挡掉模型最常见的几种出错方式。"""
    q = str(entry.get("q", "")).strip()
    if len(q) < 8:
        return False, "题干过短"

    hit = next((w for w in FIGURE_WORDS if w in q), None)
    if hit:
        return False, f"题干出现「{hit}」，需要配图但系统无法配图"

    options = entry.get("options")
    if not isinstance(options, list) or len(options) != 4:
        return False, "选项不是 4 个"
    for idx, prefix in enumerate(["A.", "B.", "C.", "D."]):
        if not str(options[idx]).strip().startswith(prefix):
            return False, f"第 {idx + 1} 个选项缺少 {prefix} 前缀"
    if len({normalize(o) for o in options}) != 4:
        return False, "有重复选项"

    answer = entry.get("answer")
    if not isinstance(answer, int) or not 0 <= answer <= 3:
        return False, "answer 不是 0–3 的整数"

    if len(str(entry.get("explanation", "")).strip()) < 10:
        return False, "缺少考点解析"

    return True, ""


def process_subject(subject, report_rows):
    bank = load_bank(subject)
    if not bank.get("sections"):
        report_rows.append((subject, "—", "⏭️ 跳过", "这一科还没有章节框架"))
        return []

    syllabus = load_syllabus(subject)
    new_items = []

    # 查重要看整科：模型可能把别章已有的题再写一次，只比对本章会漏掉
    known_norms = [
        normalize(q.get("q", ""))
        for sec in bank.get("sections", [])
        for q in sec.get("mcqs", []) or []
    ]

    for section in pick_chapters(bank):
        title = section.get("title", "")

        try:
            parsed = extract_json_array(call_gemini(build_prompt(subject, section, syllabus)))
        except gemini_api.GeminiError as e:
            report_rows.append((subject, title, "⚠️ 生成失败", str(e)[:160]))
            continue
        except json.JSONDecodeError as e:
            report_rows.append((subject, title, "⚠️ 生成失败", f"模型回的不是合法 JSON：{e}"))
            continue

        if not isinstance(parsed, list):
            report_rows.append((subject, title, "⚠️ 生成失败", "模型没有返回数组"))
            continue

        kept = 0
        for entry in parsed:
            ok, why = validate(entry)
            if not ok:
                report_rows.append((subject, title, "🚫 已丢弃", why))
                continue
            if too_similar(entry.get("q", ""), known_norms):
                report_rows.append((subject, title, "🚫 已丢弃", "与既有题目太相似"))
                continue

            known_norms.append(normalize(entry.get("q", "")))
            item = {
                "id": f"{subject}_gen_{uuid.uuid4().hex[:8]}",
                "subject": subject,
                "type": "mcq",
                "chapter_id": section.get("id", "unclassified"),
                "chapter_title": title,
                "q": entry.get("q", "").strip(),
                "options": [str(o).strip() for o in entry["options"]],
                "answer": entry["answer"],
                "explanation": entry.get("explanation", "").strip(),
                "origin": "ai_generated",
                "answer_source": "generated",
                "needs_expert_check": True,
                "flags": [],
                "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "syllabus_used": bool(syllabus),
            }
            item["flags"] += qa.text_problems(item)
            new_items.append(item)
            kept += 1

        if kept:
            report_rows.append((subject, title, "✅ 已生成", f"{kept} 题" + ("（依官方考纲）" if syllabus else "（仅依章节标题）")))

    # 整科一次复核，比每章各打一次省呼叫次数
    notes = []
    qa.cross_check(API_KEY, subject, new_items, notes)
    report_rows.extend((subject, "—", "⚠️ 复核", n) for n in notes)
    return new_items


def generate_report(rows, total):
    lines = [
        "# 🤖 AI 依考纲出题 · 待审批次",
        "",
        f"> 本批次共产出 **{total}** 道原创选择题，全部停在待审区。",
        "",
        "> ⚠️ **这些题目是 AI 写的，科学正确性未经验证。**",
        "> 每题都请 AI 不看答案重做过一次；对不上的会在 /dev 展开要你逐题看，其余收在「一键采纳」清单。",
        "> 复核用的是同一个模型家族，两次都错的题它抓不到 —— 一键采纳前请扫一眼。",
        "",
        "| 科目 | 章节 | 状态 | 说明 |",
        "|---|---|---|---|",
    ]
    for subject, chapter, status, detail in rows:
        lines.append(f"| {SUBJECT_LABEL.get(subject, subject)} | {chapter} | {status} | {detail} |")
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    if not API_KEY:
        print("⚠️ 未设置 GEMINI_API_KEY，跳过本次出题。", file=sys.stderr)
        return

    targets = [ONLY_SUBJECT] if ONLY_SUBJECT in SUBJECTS else SUBJECTS
    rows = []
    all_new = []
    for subject in targets:
        all_new.extend(process_subject(subject, rows))

    if not all_new:
        generate_report(rows, 0)
        print("本次没有产出可用的新题。原因如下：")
        for subject, chapter, status, detail in rows:
            print(f"  [{status}] {SUBJECT_LABEL.get(subject, subject)} · {chapter} —— {detail}")
        if not rows:
            print("  （连一个章节都没轮到：这一科可能还没有章节框架）")
        return

    pending = {"items": []}
    if os.path.exists(PENDING_PATH):
        with open(PENDING_PATH, encoding="utf-8") as f:
            try:
                pending = json.load(f)
            except json.JSONDecodeError:
                pending = {"items": []}
    pending.setdefault("items", [])
    pending["items"].extend(all_new)
    pending["generated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

    os.makedirs(PAPERS_DIR, exist_ok=True)
    with open(PENDING_PATH, "w", encoding="utf-8") as f:
        json.dump(pending, f, ensure_ascii=False, indent=2)
        f.write("\n")

    generate_report(rows, len(all_new))
    with open(STATUS_FLAG_PATH, "w") as f:
        f.write("true")

    print(f"✅ 本批次新增 {len(all_new)} 道待审原创题，报告写入 {REPORT_PATH}")


if __name__ == "__main__":
    main()
