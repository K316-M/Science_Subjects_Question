import os
import json
import glob

JSON_PATH = "papers/biology_question_bank.json"
REPORT_PATH = "INSPECTION_REPORT.md"

def inspect_database():
    if not os.path.exists(JSON_PATH):
        return None, ["未找到题库文件 papers/biology_question_bank.json"]

    with open(JSON_PATH, "r", encoding="utf-8") as f:
        try:
            data = json.load(f)
        except Exception as e:
            return None, [f"JSON 语法损坏，解析失败: {str(e)}"]

    issues = []
    sections = data.get("sections", [])
    
    # 逐章逐题扫描
    for sec_idx, sec in enumerate(sections):
        sec_title = sec.get("title", f"第 {sec_idx+1} 章")
        
        # 1. 检查选择题
        for q_idx, q in enumerate(sec.get("mcqs", [])):
            q_text = q.get("q", "")
            q_short = q_text[:30].replace("\n", " ") + "..."
            
            # 检测是否缺图
            has_fig = bool(q.get("figure") or q.get("image"))
            has_fig_keyword = any(kw in q_text for kw in ["图", "曲线", "装置", "示意图", "如下"])
            if has_fig_keyword and not has_fig:
                issues.append({
                    "chapter": sec_title,
                    "type": "📷 缺失配图",
                    "snippet": q_short,
                    "action": "题干涉及图表但未提供图片，请拍照上传并将文件名写入 `image` 字段"
                })
            
            # 检测图片路径是否为死链
            img_path = q.get("image")
            if img_path and not img_path.startswith("http"):
                clean_path = img_path.lstrip("./").lstrip("/")
                if not os.path.exists(clean_path):
                    issues.append({
                        "chapter": sec_title,
                        "type": "🔗 图片死链 (404)",
                        "snippet": q_short,
                        "action": f"文件 `{img_path}` 不存在，请检查图片是否已上传或大小写是否匹配"
                    })

            # 检测答案与选项是否完整
            options = q.get("options", [])
            if len(options) != 4:
                issues.append({
                    "chapter": sec_title,
                    "type": "⚠️ 选项缺失",
                    "snippet": q_short,
                    "action": f"当前仅有 {len(options)} 个选项，需补全为 4 项 (A/B/C/D)"
                })
            if q.get("answer") not in [0, 1, 2, 3]:
                issues.append({
                    "chapter": sec_title,
                    "type": "❓ 答案未定/异常",
                    "snippet": q_short,
                    "action": "标准答案序号异常，请手动指定 0(A), 1(B), 2(C), 3(D)"
                })

        # 2. 检查主观题
        for s_idx, sq in enumerate(sec.get("subjectives", [])):
            sq_text = sq.get("question", "")
            sq_short = sq_text[:30].replace("\n", " ") + "..."
            if not sq.get("answer"):
                issues.append({
                    "chapter": sec_title,
                    "type": "📝 缺少答案",
                    "snippet": sq_short,
                    "action": "该做答题尚无参考得分点，请手动补充"
                })

    return data, issues

def generate_markdown_report(issues):
    if not issues:
        content = """# 🩺 独中理科题库健康检查报告

> **检查状态**：全部正常 ✅  
> **更新时间**：所有题目均具备完整的选项、配图和标准答案，无死链与格式缺陷。
"""
    else:
        content = f"""# 🩺 独中理科题库检讨报告（待手动确认项）

> 系统巡检发现 **{len(issues)} 处需要您手动修改或确认** 的题目。请在有空时按下方指引在 `papers/biology_question_bank.json` 中调整：

| 章节与位置 | 问题类型 | 题干摘要 | 建议处理动作 |
|---|---|---|---|
"""
        for item in issues:
            content += f"| {item['chapter']} | `{item['type']}` | {item['snippet']} | {item['action']} |\n"

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    
    return content

if __name__ == "__main__":
    _, issues = inspect_database()
    report = generate_markdown_report(issues)
    print("检讨报告生成完毕：")
    print(report)
    
    # 传递给 GitHub Actions 判断是否有问题
    with open("has_issues.txt", "w") as f:
        f.write("true" if issues else "false")
