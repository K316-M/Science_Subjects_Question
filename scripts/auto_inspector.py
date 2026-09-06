import os
import json
import glob
import google.generativeai as genai

API_KEY = os.environ.get("GEMINI_API_KEY")
JSON_PATH = "papers/biology_question_bank.json"

if not API_KEY:
    print("❌ 未检测到 GEMINI_API_KEY，跳过云端执行。")
    exit(0)

genai.configure(api_key=API_KEY)
model = genai.GenerativeModel("gemini-1.5-pro")

# 1. 缺陷与 Bug 自动巡检（数据完整性校验）
def run_health_check(data):
    print("🔍 正在执行网站缺陷与题库完整性巡检...")
    issues = []
    
    for sec_idx, sec in enumerate(data.get("sections", [])):
        # 检查选择题
        for q_idx, q in enumerate(sec.get("mcqs", [])):
            if not q.get("q"):
                issues.append(f"第 {sec_idx+1} 章第 {q_idx+1} 题缺少题干描述")
            if len(q.get("options", [])) != 4:
                issues.append(f"第 {sec_idx+1} 章第 {q_idx+1} 题选项不足 4 项")
            if q.get("answer") not in [0, 1, 2, 3]:
                issues.append(f"第 {sec_idx+1} 章第 {q_idx+1} 题标准答案异常")
            # 检测图片路径是否存在（防 404 死链）
            img_path = q.get("image")
            if img_path and not img_path.startswith("http"):
                local_path = img_path.lstrip("./").lstrip("/")
                if not os.path.exists(local_path):
                    issues.append(f"⚠️ 图片死链告警：文件不存在 -> {img_path}")
    
    if issues:
        print("🚨 巡检发现缺陷如下：")
        for iss in issues:
            print(" -", iss)
    else:
        print("✅ 题库与页面依赖检查全部通过，无死链与数据缺陷。")

# 2. 读取现有数据并执行维护
def main():
    if os.path.exists(JSON_PATH):
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            db_data = json.load(f)
    else:
        print("❌ 未找到题库文件。")
        return

    # 执行巡检
    run_health_check(db_data)

    # 扫描 papers/ 目录下是否有新上传的待处理试卷照片
    pending_images = glob.glob("papers/*.jpg") + glob.glob("papers/*.png")
    if pending_images:
        print(f"📷 发现 {len(pending_images)} 张新考卷，启动 AI 审题与入库流程...")
        # 提取后自动整合写入逻辑

    # 规范化写回
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(db_data, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
