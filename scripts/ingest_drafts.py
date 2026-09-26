#!/usr/bin/env python3
"""
AI 自动录题 + 审题
------------------
扫描 drafts/<subject>/ 里管理员上传的档案（照片、PDF、Word、PowerPoint、纯文字都收，
读法见 ingest_formats.py），请 Gemini 转写成 papers/*.json 的题目格式，再逐题审过：

  1. 格式：题干不能空、选择题要恰好 4 个 A–D 选项、答案要是 0–3、选项不能重复
  2. 重复：和正式题库、待审区、同一批里的题目比对，太像的不收
  3. 文字：夹英文虚词、残留转写标记、题号没去掉；Word/PPT/文字档还会逐字和原档比对，
     AI 改字、加字、漏字都标出来（检查细节见 qa.py）
  4. 答案复核：另外请 Gemini 在「看不到答案」的情况下重做一次选择题，
     和原档标的答案（萤光笔、答案表）或第一次推断的答案比对，不一致就标出来

格式坏掉、重复的题不进待审区，只写在报告里；其余进 papers/pending_approval.json。
/dev「AI 录题待审」把被标出问题的题展开给你改，没问题的收成清单一键采纳。
处理完的原档直接删掉（git 历史里还找得回来）；读不了的档案（旧版 .doc 等）留在原处，报告里写要另存成什么。

需要 GEMINI_API_KEY（GitHub Secrets）；没有就跳过。
"""

import datetime
import glob
import json
import os
import re
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gemini_api
import ingest_formats
import qa
from qa import extract_json_array
from generate_questions import normalize, too_similar

SUBJECTS = ["biology", "chemistry", "physics"]
SUBJECT_LABEL = {"biology": "生物", "chemistry": "化学", "physics": "物理"}
DRAFTS_DIR = "drafts"
PAPERS_DIR = "papers"
IMAGES_DIR = "images"
PENDING_PATH = os.path.join(PAPERS_DIR, "pending_approval.json")
REPORT_PATH = "INGEST_REPORT.md"
STATUS_FLAG_PATH = "has_new_ingest.txt"      # true：有新题，开 PR
PROBLEM_FLAG_PATH = "has_ingest_problems.txt"  # true：没有新题但有档案失败，开 Issue
SKIP_NAMES = {".gitkeep", "README.md"}
FIGURE_WORDS = ["如图", "下图", "上图", "图中", "图示", "曲线", "装置图", "示意图", "下表", "如下表"]
LETTERS = "ABCD"

API_KEY = os.environ.get("GEMINI_API_KEY")


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return default


def load_bank(subject):
    return load_json(os.path.join(PAPERS_DIR, f"{subject}_question_bank.json"), {"sections": []})


def build_prompt(subject, chapters):
    chapter_lines = "\n".join(f'- {c["id"]}: {c["title"]}' for c in chapters) or "（本科目暂无章节框架，一律填 unclassified）"
    return f"""你是马来西亚华文独立中学（董总 UEC 高中统考）{SUBJECT_LABEL.get(subject, subject)}科的资深命题老师兼录入编辑。
下面是一份题目资料（可能是照片、PDF，或从 Word/PowerPoint 抽出的文字），请把其中【每一道题】转写为规范化 JSON，严格遵守：

0. 只取两样东西：题目的文字（题干、选项、原档附的答案）与题目要看的图。
   页首页尾、页码、学校名、「(0 分数)」这类分数或作答系统的字样、说明文字都不要。
   题干与选项照原文一字不改（包括化学式、单位、上下标），不要翻译、不要润饰。
1. 题干去掉原始题号（如 "1." "(3)"），保留题干文字；题干里的罗马数字叙述（I、II、III…）要保留。
   罗马数字叙述每一项各占一行：问句在前，I、II、III、IV… 各自换行（JSON 里用 \\n），原档挤在同一行也要拆开；只加换行，不改字。
2. 选择题：options 恰好 4 个字符串，以 "A. " "B. " "C. " "D. " 开头；answer 是正确选项下标（0=A…3=D）；
   explanation 写一段简明、符合统考评分标准的考点解析。
3. 非选择题（简答/计算/论述）：输出 question 与含得分点的参考答案 answer_text。
4. 答案来源 answer_source —— 老师常用「高光」标正确答案：
   - Word/PPT 抽出的文字里，「[标记:萤光]…[/标记]」「[标记:底色]…」「[标记:底线]…」「[标记:彩色字]…」
     是原档的萤光笔、底色、底线、彩色字。标在某个选项（或选项字母）上，那个选项就是答案。
   - 照片与 PDF 请直接看：萤光笔涂过、圈起来、打勾、写上的字母、颜色不同的选项，都是标出来的答案。
   - 文末或另页的答案表也算。
   - 标记只落在题干里的几个字上（例如强调「不」「错误」），那是提醒，不是答案。
   - 看得出原档标了答案就照原档，填 "marked"；原档完全没标，才由你自己作答，填 "ai"。
5. figure_needed：题目要看图/图表/装置图才能作答（例如看泌尿系统图回答部位名称）就填 true。
   - Word/PPT：原档文字里有「[图N]」时，把这题用到的图编号填进 figure_refs（例如 [1]），没有就填 []。
   - 照片/PDF：填 figure_box = {{"page": 第几页（照片填 1）, "box": [ymin, xmin, ymax, xmax]}}，
     座标是 0–1000 的相对位置，只框图本身（含图上的标号与图说），不要框进题干与选项文字。
     几题共用同一张图就各自填同一个框。
6. 依下列官方章节框架判断所属章节，填 chapter_id；真的判断不了填 "unclassified"：
{chapter_lines}

只回传一个 JSON 数组，不要 Markdown 代码块或任何说明文字。每项：
{{
  "type": "mcq 或 subjective",
  "chapter_id": "章节id 或 unclassified",
  "figure_needed": true/false,
  "figure_refs": [],
  "figure_box": null,
  "answer_source": "marked 或 ai",
  "q": "题干（mcq）",
  "question": "题干（subjective）",
  "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
  "answer": 0,
  "explanation": "考点解析（mcq）",
  "answer_text": "参考答案与得分点（subjective）"
}}
"""


def list_draft_files(draft_dir):
    """drafts/<科目>/ 底下的档案（不含子目录）"""
    return [p for p in sorted(glob.glob(os.path.join(draft_dir, "*")))
            if os.path.isfile(p) and os.path.basename(p) not in SKIP_NAMES and not os.path.basename(p).startswith(".")]


def structural_problem(record):
    """格式坏掉就回传原因；没问题回传 None"""
    if record["type"] == "subjective":
        if len(record.get("question", "").strip()) < 4:
            return "题干是空的"
        if len(str(record.get("answer", "")).strip()) < 2:
            return "缺参考答案"
        return None
    if len(record.get("q", "").strip()) < 4:
        return "题干是空的"
    options = record.get("options")
    if not isinstance(options, list) or len(options) != 4:
        return f"选项有 {len(options) if isinstance(options, list) else 0} 个，不是 4 个"
    for i, opt in enumerate(options):
        if not re.match(rf"^{LETTERS[i]}[.．]\s*\S", str(opt).strip()):
            return f"第 {i + 1} 个选项不是以「{LETTERS[i]}.」开头"
    if len({normalize(re.sub(r'^[A-D][.．]\s*', '', o)) for o in options}) != 4:
        return "有重复选项"
    if not isinstance(record.get("answer"), int) or not 0 <= record["answer"] <= 3:
        return "答案不是 A–D"
    return None


def stem_of(record):
    return record.get("q") or record.get("question") or ""


def process_file(path, subject, ctx, report):
    fname = os.path.basename(path)
    rel = path.replace("\\", "/")
    try:
        parts, notes, media = ingest_formats.to_parts(path)
    except ingest_formats.Unsupported as e:
        report["files"].append({"subject": subject, "source": fname, "status": "⛔ 读不了", "detail": str(e)})
        return None
    # Word/PPT/文字档有原文可以逐字比对；照片与 PDF 没有，只能靠答案复核
    first = parts[0].get("text", "") if parts else ""
    source = qa.canon(first) if first.startswith(ingest_formats.SOURCE_HEADER) else None

    try:
        entries = extract_json_array(gemini_api.generate(API_KEY, [{"text": ctx["prompt"]}] + parts, temperature=0.2))
    except (gemini_api.GeminiError, json.JSONDecodeError) as e:
        report["files"].append({"subject": subject, "source": fname, "status": "⚠️ 转写失败",
                                "detail": f"{str(e)[:120]}（档案留在原处，下次推送会再试）"})
        return None

    accepted, rejected = [], []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        qtype = "subjective" if entry.get("type") == "subjective" else "mcq"
        chapter_id = entry.get("chapter_id") if entry.get("chapter_id") in ctx["chapter_ids"] else "unclassified"
        record = {
            "id": f"{subject}_{uuid.uuid4().hex[:10]}",
            "subject": subject,
            "type": qtype,
            "chapter_id": chapter_id,
            "chapter_title": ctx["chapter_title"].get(chapter_id, "未分类（请人工归类）"),
            "source_draft": rel,
            "answer_source": "marked" if entry.get("answer_source") == "marked" else "ai",
            "flags": list(notes),
            "ingested_at": now_iso(),
        }
        if qtype == "subjective":
            record["question"] = str(entry.get("question") or entry.get("q") or "").strip()
            record["answer"] = str(entry.get("answer_text") or entry.get("answer") or "").strip()
            record["flags"].append("做答题的参考答案没有自动复核，请核对得分点")
        else:
            record["q"] = str(entry.get("q") or entry.get("question") or "").strip()
            record["options"] = [str(o).strip() for o in (entry.get("options") or [])]
            record["answer"] = entry.get("answer")
            record["explanation"] = str(entry.get("explanation") or "").strip()
            if len(record["explanation"]) < 10:
                record["flags"].append("缺考点解析")

        problem = structural_problem(record)
        if problem:
            rejected.append((record, f"格式有问题：{problem}"))
            continue
        record["flags"] += qa.text_problems(record)
        if source:
            record["flags"] += qa.source_drift(record, source)
        stem = stem_of(record)
        if too_similar(stem, ctx["known"]):
            rejected.append((record, "和题库或待审区里已有的题目太像"))
            continue
        ctx["known"].append(normalize(stem))

        # 配图：Word/PPT 用它指到的内嵌图；照片、PDF 照 Gemini 回报的位置裁；都不行才退回整张原图或请人工补
        if entry.get("figure_needed"):
            refs = [n for n in (entry.get("figure_refs") or []) if isinstance(n, int) and n in media]
            fbox = entry.get("figure_box") if isinstance(entry.get("figure_box"), dict) else {}
            cropped = None
            if not refs and fbox.get("box") and (0 in media or path.lower().endswith(".pdf")):
                cropped = ingest_formats.crop_figure(path, fbox.get("page", 1), fbox["box"],
                                                     photo=media[0][1] if 0 in media else None)
            if refs:
                ext, data = media[refs[0]]
                record["image"] = save_image(subject, record["id"], ext, data)
                if len(refs) > 1:
                    record["flags"].append(f"这题用到 {len(refs)} 张图，只自动放了第一张")
            elif cropped:
                record["image"] = save_image(subject, record["id"], *cropped)
                record["flags"].append("配图是 AI 从原档自动裁的，请确认有没有裁到整张图")
            elif 0 in media:
                ext, data = media[0]
                record["image"] = save_image(subject, record["id"], ext, data)
                record["flags"].append("含配图：放的是整页原图，请裁剪成这题的图")
            else:
                record["flags"].append("需要配图，但原档里抓不到图，请从原档截图补上")
        elif any(w in stem for w in FIGURE_WORDS):
            record["flags"].append("题干提到图表，但 AI 判断不需要配图，请确认")
        accepted.append(record)

    qa.cross_check(API_KEY, subject, accepted, report["notes"])
    report["files"].append({"subject": subject, "source": fname, "status": "✅ 已录入",
                            "detail": f"录入 {len(accepted)} 题" + (f"，退回 {len(rejected)} 题" if rejected else "")})
    report["accepted"].extend(accepted)
    report["rejected"].extend((subject, fname, r, why) for r, why in rejected)
    return accepted


def save_image(subject, item_id, ext, data):
    os.makedirs(os.path.join(IMAGES_DIR, subject), exist_ok=True)
    name = f"{item_id}{ext or '.png'}"
    with open(os.path.join(IMAGES_DIR, subject, name), "wb") as f:
        f.write(data)
    return f"./images/{subject}/{name}"


def process_subject(subject, pending_items, report):
    draft_dir = os.path.join(DRAFTS_DIR, subject)
    files = list_draft_files(draft_dir) if os.path.isdir(draft_dir) else []
    if not files:
        return []

    bank = load_bank(subject)
    chapters = [{"id": s["id"], "title": s["title"]} for s in bank.get("sections", [])]
    known = [normalize(q.get("q", "")) for s in bank.get("sections", []) for q in s.get("mcqs", [])]
    known += [normalize(q.get("question", "")) for s in bank.get("sections", []) for q in s.get("subjectives", [])]
    known += [normalize(stem_of(i)) for i in pending_items if i.get("subject") == subject]
    ctx = {"prompt": build_prompt(subject, chapters), "chapter_ids": {c["id"] for c in chapters},
           "chapter_title": {c["id"]: c["title"] for c in chapters}, "known": known}

    new_items = []
    for path in files:
        got = process_file(path, subject, ctx, report)
        if got is None:
            continue              # 读不了或转写失败：档案留着，报告里说明
        new_items.extend(got)
        os.remove(path)           # 题目已经进待审区，原档不留在仓库里（git 历史里找得回来）
    return new_items


def generate_report(report):
    acc, rej = report["accepted"], report["rejected"]
    doubtful = [r for r in acc if any(f.startswith("⚠️") for f in r["flags"])]
    flagged = [r for r in acc if r["flags"]]
    lines = ["# 🧪 AI 录题与审题报告", "",
             f"> 录入 **{len(acc)}** 题进待审区"
             + (f"：**{len(flagged)}** 题被标出问题要逐题看，{len(acc) - len(flagged)} 题没问题可一键采纳" if acc else "")
             + (f"；退回 **{len(rej)}** 题" if rej else "") + "。"]
    if acc:
        lines.append("> 合并这个 PR 只是把题目放进待审区；之後到 /dev「AI 录题待审」处理，按「采纳」才会进正式题库。")
    else:
        lines.append("> 这次一题都没录到，原因看下面「档案」那一栏。转写失败的档案留在原处，下次推送或手动重跑工作流会再试。")
    lines.append("")
    if report["notes"]:
        lines += ["**注意**", ""] + [f"- {n}" for n in report["notes"]] + [""]

    lines += ["## 档案", "", "| 科目 | 档案 | 状态 | 说明 |", "|---|---|---|---|"]
    for f in report["files"]:
        lines.append(f"| {SUBJECT_LABEL.get(f['subject'], f['subject'])} | {f['source']} | {f['status']} | {f['detail']} |")

    if doubtful:
        lines += ["", "## 答案有疑或和原档不一致，优先核对", "", "| 题目 | 疑点 |", "|---|---|"]
        for r in doubtful:
            why = "；".join(f for f in r["flags"] if f.startswith("⚠️"))
            lines.append(f"| {stem_of(r)[:40]}… | {why} |")

    if acc:
        lines += ["", "## 录入的题目", "", "| 科目 | 章节 | 题目 | 答案 | 提醒 |", "|---|---|---|---|---|"]
    for r in acc:
        ans = LETTERS[r["answer"]] if r["type"] == "mcq" else "简答"
        src = "（原档标）" if r.get("answer_source") == "marked" and r["type"] == "mcq" else ""
        flags = "；".join(f for f in r["flags"] if not f.startswith("⚠️")) or "-"
        lines.append(f"| {SUBJECT_LABEL.get(r['subject'], r['subject'])} | {r['chapter_title']} | {stem_of(r)[:30]}… | {ans}{src} | {flags} |")

    if rej:
        lines += ["", "## 退回的题目（没进待审区）", "", "| 档案 | 题目 | 原因 |", "|---|---|---|"]
        for subject, fname, r, why in rej:
            lines.append(f"| {fname} | {stem_of(r)[:30] or '（空）'}… | {why} |")

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    if not API_KEY:
        print("⚠️ 未设置 GEMINI_API_KEY，跳过本次自动录题。", file=sys.stderr)
        return

    pending = load_json(PENDING_PATH, {"items": []})
    pending.setdefault("items", [])
    report = {"files": [], "accepted": [], "rejected": [], "notes": []}
    new_items = []
    for subject in SUBJECTS:
        new_items.extend(process_subject(subject, pending["items"], report))

    if not report["files"]:
        print("drafts/ 里没有待处理的档案。")
        return

    generate_report(report)
    if new_items:
        pending["items"].extend(new_items)
        pending["generated_at"] = now_iso()
        with open(PENDING_PATH, "w", encoding="utf-8") as f:
            json.dump(pending, f, ensure_ascii=False, indent=2)
            f.write("\n")
        with open(STATUS_FLAG_PATH, "w") as f:
            f.write("true")
        print(f"✅ 录入 {len(new_items)} 题进待审区，报告：{REPORT_PATH}")
    else:
        # 没有新题但有档案失败：以前这种情况什么都不说，现在开 Issue 提醒
        with open(PROBLEM_FLAG_PATH, "w") as f:
            f.write("true")
        print(f"⚠️ 没有录到题目，原因写在 {REPORT_PATH}")


if __name__ == "__main__":
    main()
