#!/usr/bin/env python3
"""
AI 自动录题脚本
----------------
扫描 drafts/<subject>/ 目录下管理员新上传的试卷照片，调用 Gemini 多模态模型
把图片转写为符合本项目 papers/*.json Schema 的题目对象，汇总写入
papers/pending_approval.json，并生成 INGEST_REPORT.md 供人工审核。

使用方式：管理员用手机拍照，把 JPG/PNG 丢进 drafts/biology/、
drafts/chemistry/ 或 drafts/physics/ 目录并推送到仓库（或直接用 GitHub
手机 App 上传），GitHub Actions 会自动运行本脚本并开出一个待审核 PR。

运行需要在仓库 Secrets 中配置 GEMINI_API_KEY；未配置时脚本会直接跳过。
"""

import base64
import datetime
import glob
import json
import mimetypes
import os
import re
import shutil
import sys
import uuid
import urllib.error
import urllib.request

SUBJECTS = ["biology", "chemistry", "physics"]
DRAFTS_DIR = "drafts"
PAPERS_DIR = "papers"
IMAGES_DIR = "images"
PENDING_PATH = os.path.join(PAPERS_DIR, "pending_approval.json")
REPORT_PATH = "INGEST_REPORT.md"
STATUS_FLAG_PATH = "has_new_ingest.txt"

MODEL = os.environ.get("GEMINI_MODEL", "gemini-1.5-flash")
API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"


def load_chapters(subject):
    """读取该科目已存在的官方章节框架，用于给模型提供分类依据。"""
    path = os.path.join(PAPERS_DIR, f"{subject}_question_bank.json")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return [{"id": s["id"], "title": s["title"]} for s in data.get("sections", [])]


def build_prompt(subject, chapters):
    chapter_lines = "\n".join(f'- {c["id"]}: {c["title"]}' for c in chapters)
    if not chapter_lines:
        chapter_lines = "（本科目暂无章节框架，一律填 unclassified）"

    return f"""你是马来西亚华文独立中学（董总 UEC 高中统考）{subject} 科目的资深命题老师兼录入编辑。
请仔细阅读这张试卷/题目照片，把其中【每一道题】转写为规范化 JSON 对象，严格遵守：

1. 题干需去除原始题号（如 "1." "(3)"），但保留题干文字与空行结构。
2. 选择题：options 必须恰好是 4 个字符串，并以 "A. " "B. " "C. " "D. " 为前缀；
   answer 为正确选项下标（0=A, 1=B, 2=C, 3=D）；并撰写一段简明扼要、符合统考评分标准的考点解析 explanation。
3. 非选择题（简答/计算/论述）：输出 question 与包含得分点的详细参考答案 answer_text。
4. 判断该题是否引用了图片/图表/装置图/曲线图等纯文字无法还原的视觉材料（如“如图所示”），
   是则 figure_needed=true，否则为 false。
5. 依据以下官方章节框架判断本题所属章节，返回对应 chapter_id；确实无法判断时填 "unclassified"：
{chapter_lines}

只返回一个 JSON 数组，不要包含 Markdown 代码块标记或任何额外说明文字。每项结构：
{{
  "type": "mcq 或 subjective",
  "chapter_id": "章节id 或 unclassified",
  "figure_needed": true/false,
  "q": "题干（mcq 用）",
  "question": "题干（subjective 用）",
  "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
  "answer": 0,
  "explanation": "考点解析（mcq 用）",
  "answer_text": "参考答案与得分点（subjective 用）"
}}
"""


def call_gemini(image_path, prompt):
    with open(image_path, "rb") as f:
        img_bytes = f.read()
    mime = mimetypes.guess_type(image_path)[0] or "image/jpeg"
    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": mime, "data": base64.b64encode(img_bytes).decode("ascii")}},
            ]
        }],
        "generationConfig": {"temperature": 0.2},
    }
    req = urllib.request.Request(
        f"{GEMINI_ENDPOINT}?key={API_KEY}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    return result["candidates"][0]["content"]["parts"][0]["text"]


def extract_json_array(text):
    cleaned = re.sub(r"^```(json)?|```$", "", text.strip(), flags=re.M).strip()
    return json.loads(cleaned)


def list_draft_images(draft_dir):
    images = []
    for p in sorted(glob.glob(os.path.join(draft_dir, "*"))):
        if not os.path.isfile(p):
            continue
        mime = mimetypes.guess_type(p)[0]
        if mime and mime.startswith("image/"):
            images.append(p)
    return images


def process_subject(subject, report_items):
    draft_dir = os.path.join(DRAFTS_DIR, subject)
    image_paths = list_draft_images(draft_dir) if os.path.isdir(draft_dir) else []
    if not image_paths:
        return []

    processed_dir = os.path.join(draft_dir, "_processed")
    os.makedirs(processed_dir, exist_ok=True)
    os.makedirs(os.path.join(IMAGES_DIR, subject), exist_ok=True)

    chapters = load_chapters(subject)
    chapter_ids = {c["id"] for c in chapters}
    chapter_title_by_id = {c["id"]: c["title"] for c in chapters}
    prompt = build_prompt(subject, chapters)

    new_items = []
    for img_path in image_paths:
        fname = os.path.basename(img_path)
        try:
            raw_text = call_gemini(img_path, prompt)
            parsed = extract_json_array(raw_text)
        except (urllib.error.URLError, json.JSONDecodeError, KeyError, IndexError) as e:
            report_items.append({
                "subject": subject, "source": fname, "status": "⚠️ 转写失败",
                "detail": str(e), "flags": ["请检查图片清晰度或手动录入"],
            })
            continue

        for entry in parsed:
            chapter_id = entry.get("chapter_id") or "unclassified"
            if chapter_id not in chapter_ids:
                chapter_id = "unclassified"
            item_id = f"{subject}_{uuid.uuid4().hex[:10]}"
            flags = []

            image_field = None
            if entry.get("figure_needed"):
                ext = os.path.splitext(fname)[1] or ".jpg"
                new_image_name = f"{item_id}{ext}"
                dest = os.path.join(IMAGES_DIR, subject, new_image_name)
                shutil.copy2(img_path, dest)
                image_field = f"./images/{subject}/{new_image_name}"
                flags.append("含配图：已复制原图整页，尚未精确裁剪，请人工裁剪后替换")

            q_text = entry.get("q") or entry.get("question") or ""
            if not entry.get("figure_needed") and re.search(r"如图|图示|曲线|装置图|示意图", q_text):
                flags.append("题干疑似引用图表但模型判定无需配图，请人工确认")

            record = {
                "id": item_id,
                "type": entry.get("type", "mcq"),
                "chapter_id": chapter_id,
                "chapter_title": chapter_title_by_id.get(chapter_id, "未分类（请人工归类）"),
                "source_draft": os.path.join(DRAFTS_DIR, subject, fname).replace("\\", "/"),
                "flags": flags,
                "ingested_at": datetime.datetime.utcnow().isoformat() + "Z",
            }
            if entry.get("type") == "subjective":
                record["question"] = entry.get("question", "")
                record["answer"] = entry.get("answer_text", "")
            else:
                record["q"] = entry.get("q", "")
                record["options"] = entry.get("options", [])
                record["answer"] = entry.get("answer")
                record["explanation"] = entry.get("explanation", "")
            if image_field:
                record["image"] = image_field

            new_items.append(record)
            snippet = (record.get("q") or record.get("question", ""))[:30]
            report_items.append({
                "subject": subject, "source": fname, "status": "✅ 已转写",
                "detail": f"{record['chapter_title']} | {snippet}...",
                "flags": flags,
            })

        shutil.move(img_path, os.path.join(processed_dir, fname))

    return new_items


def generate_report(report_items):
    lines = [
        "# 🧪 AI 自动录题批次报告",
        "",
        f"> 本批次共处理 {len(report_items)} 条题目/条目，请管理员在合并本 PR 前逐条核对图片、答案与章节归类是否准确。",
        "",
        "| 科目 | 来源图片 | 状态 | 详情 | 提醒 |",
        "|---|---|---|---|---|",
    ]
    for item in report_items:
        flags = "；".join(item.get("flags", [])) or "-"
        lines.append(f"| {item['subject']} | {item['source']} | {item['status']} | {item.get('detail','')} | {flags} |")
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    if not API_KEY:
        print("⚠️ 未设置 GEMINI_API_KEY，跳过本次自动录题。", file=sys.stderr)
        return

    report_items = []
    all_new_items = []
    for subject in SUBJECTS:
        all_new_items.extend(process_subject(subject, report_items))

    if not all_new_items:
        print("没有发现新的草稿图片，无需处理。")
        return

    pending = {"items": []}
    if os.path.exists(PENDING_PATH):
        with open(PENDING_PATH, encoding="utf-8") as f:
            try:
                pending = json.load(f)
            except json.JSONDecodeError:
                pending = {"items": []}
    pending.setdefault("items", [])
    pending["items"].extend(all_new_items)
    pending["generated_at"] = datetime.datetime.utcnow().isoformat() + "Z"

    with open(PENDING_PATH, "w", encoding="utf-8") as f:
        json.dump(pending, f, ensure_ascii=False, indent=2)
        f.write("\n")

    generate_report(report_items)

    with open(STATUS_FLAG_PATH, "w") as f:
        f.write("true")

    print(f"✅ 本批次新增 {len(all_new_items)} 条待审核题目，报告已写入 {REPORT_PATH}")


if __name__ == "__main__":
    main()
