# 草稿录题目录（drafts/）

把手机拍的试卷照片（JPG/PNG）丢进对应科目的子目录，推送到 `main` 分支后，
GitHub Actions 会自动调用 AI 把照片转写为题库格式，并开出一个待审核 Pull Request：

- `drafts/biology/`   生物试卷照片
- `drafts/chemistry/` 化学试卷照片
- `drafts/physics/`   物理试卷照片

## 使用步骤

1. 拍照，确保题干、选项、图表清晰可读。
2. 用 GitHub 手机 App（或网页 Upload files）把照片上传到对应科目目录，直接 Commit 到 `main`。
3. 几分钟后仓库会多出一个标题为「🧪 AI 自动录题待审核」的 Pull Request，里面附带 `INGEST_REPORT.md` 审核报告。
4. 打开 PR，对照原图核对每一题的题干、选项、答案、章节归类是否正确；含配图的题目目前只是整页原图，需要你手动裁剪替换成精确的题目截图。
5. 确认无误后点击 **Merge**，Vercel 会在几秒内自动把新题目发布上线。

已处理过的照片会被自动移动到 `_processed/` 子目录，避免重复处理。

> 首次使用前，需要仓库管理员在 GitHub 仓库 Settings → Secrets and variables → Actions
> 中添加一个名为 `GEMINI_API_KEY` 的 Secret（Gemini API Key），否则工作流会跳过录题。
