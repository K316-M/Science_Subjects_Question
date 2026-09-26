import os
import json

SUBJECTS = ["biology", "chemistry", "physics"]
SUBJECT_LABEL = {"biology": "生物", "chemistry": "化学", "physics": "物理"}
PENDING_PATH = "papers/pending_approval.json"
REPORT_PATH = "INSPECTION_REPORT.md"

FIG_KEYWORDS = ["图", "曲线", "装置", "示意图", "如下"]


def bank_path(subject):
    return f"papers/{subject}_question_bank.json"


def load_json(path):
    """返回 (资料, 错误讯息)；档案不存在或坏掉都要让巡检知道。"""
    if not os.path.exists(path):
        return None, f"未找到档案 {path}"
    with open(path, "r", encoding="utf-8") as f:
        try:
            return json.load(f), None
        except Exception as e:
            return None, f"JSON 语法损坏，解析失败: {str(e)}"


def snippet_of(text):
    return str(text or "")[:30].replace("\n", " ") + "..."


def check_mcq(q, source, chapter, issues):
    """单一选择题的检查项，正式题库与待审区共用。"""
    q_text = q.get("q", "")
    q_short = snippet_of(q_text)

    # 检测是否缺图
    has_fig = bool(q.get("figure") or q.get("image"))
    if any(kw in q_text for kw in FIG_KEYWORDS) and not has_fig:
        issues.append({
            "source": source, "chapter": chapter, "type": "📷 缺失配图", "snippet": q_short,
            "action": "题干涉及图表但未提供图片，请拍照上传并将文件名写入 `image` 字段",
        })

    # 检测图片路径是否为死链
    img_path = q.get("image")
    if img_path and not str(img_path).startswith("http"):
        clean_path = str(img_path).lstrip("./").lstrip("/")
        if not os.path.exists(clean_path):
            issues.append({
                "source": source, "chapter": chapter, "type": "🔗 图片死链 (404)", "snippet": q_short,
                "action": f"文件 `{img_path}` 不存在，请检查图片是否已上传或大小写是否匹配",
            })

    # 检测答案与选项是否完整
    options = q.get("options", [])
    if len(options) != 4:
        issues.append({
            "source": source, "chapter": chapter, "type": "⚠️ 选项缺失", "snippet": q_short,
            "action": f"当前仅有 {len(options)} 个选项，需补全为 4 项 (A/B/C/D)",
        })
    if q.get("answer") not in [0, 1, 2, 3]:
        issues.append({
            "source": source, "chapter": chapter, "type": "❓ 答案未定/异常", "snippet": q_short,
            "action": "标准答案序号异常，请手动指定 0(A), 1(B), 2(C), 3(D)",
        })


def inspect_bank(subject, issues):
    source = SUBJECT_LABEL.get(subject, subject)
    path = bank_path(subject)
    data, err = load_json(path)
    if err:
        issues.append({
            "source": source, "chapter": "—", "type": "🧱 题库档案异常", "snippet": path,
            "action": err,
        })
        return

    sections = data.get("sections", [])
    if not sections:
        issues.append({
            "source": source, "chapter": "—", "type": "📭 题库为空", "snippet": path,
            "action": "这一科还没有任何章节内容，可拍题录入或用「AI 依考纲出题」补充",
        })
        return

    for sec_idx, sec in enumerate(sections):
        sec_title = sec.get("title", f"第 {sec_idx + 1} 章")
        for q in sec.get("mcqs", []) or []:
            check_mcq(q, source, sec_title, issues)

        # 主观题：必须有参考得分点
        for sq in sec.get("subjectives", []) or []:
            if not sq.get("answer"):
                issues.append({
                    "source": source, "chapter": sec_title, "type": "📝 缺少答案",
                    "snippet": snippet_of(sq.get("question", "")),
                    "action": "该做答题尚无参考得分点，请手动补充",
                })


def inspect_pending(issues):
    """待审区：AI 录题与 AI 出题的产物停在这里，合并前先扫一遍。"""
    if not os.path.exists(PENDING_PATH):
        return
    data, err = load_json(PENDING_PATH)
    if err:
        issues.append({
            "source": "待审区", "chapter": "—", "type": "🧱 题库档案异常",
            "snippet": PENDING_PATH, "action": err,
        })
        return

    items = data.get("items", []) or []
    awaiting_expert = 0
    for item in items:
        chapter = item.get("chapter_title", "未分类")
        if item.get("type") == "subjective":
            if not item.get("answer"):
                issues.append({
                    "source": "待审区", "chapter": chapter, "type": "📝 缺少答案",
                    "snippet": snippet_of(item.get("question", "")),
                    "action": "该做答题尚无参考得分点，请手动补充",
                })
        else:
            check_mcq(item, "待审区", chapter, issues)
            if not str(item.get("explanation", "")).strip():
                issues.append({
                    "source": "待审区", "chapter": chapter, "type": "🧾 缺少解析",
                    "snippet": snippet_of(item.get("q", "")),
                    "action": "选择题缺少考点解析，请补写后再合并",
                })
        if item.get("needs_expert_check"):
            awaiting_expert += 1

    # AI 生成题只汇总成一条，不要每题刷一行把报告淹掉
    if awaiting_expert:
        issues.append({
            "source": "待审区", "chapter": "—", "type": "🤖 待人工核对",
            "snippet": f"{awaiting_expert} 题 AI 生成题",
            "action": "这些题的科学正确性尚未验证，请到 /dev「AI 录题待审」核对后再采纳",
        })


def inspect_all():
    issues = []
    for subject in SUBJECTS:
        inspect_bank(subject, issues)
    inspect_pending(issues)
    return issues


def generate_markdown_report(issues):
    if not issues:
        content = """# 🩺 独中理科题库健康检查报告

> **检查状态**：全部正常 ✅  
> **检查范围**：生物、化学、物理三科题库，以及待审区。
> 所有题目均具备完整的选项、配图和标准答案，无死链与格式缺陷。
"""
    else:
        content = f"""# 🩺 独中理科题库检讨报告（待手动确认项）

> 系统巡检发现 **{len(issues)} 处需要您手动修改或确认** 的题目。
> 检查范围：生物、化学、物理三科题库，以及待审区 `papers/pending_approval.json`。

| 来源 | 章节与位置 | 问题类型 | 题干摘要 | 建议处理动作 |
|---|---|---|---|---|
"""
        for item in issues:
            content += (
                f"| {item['source']} | {item['chapter']} | `{item['type']}` "
                f"| {item['snippet']} | {item['action']} |\n"
            )

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(content)

    return content


if __name__ == "__main__":
    issues = inspect_all()
    report = generate_markdown_report(issues)
    print("检讨报告生成完毕：")
    print(report)

    # 传递给 GitHub Actions 判断是否有问题
    with open("has_issues.txt", "w") as f:
        f.write("true" if issues else "false")
