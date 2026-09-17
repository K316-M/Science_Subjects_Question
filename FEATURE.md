# 独中理科自主学习平台 · 技术架构现状与全自动开发蓝图

> **目标受众**：马来西亚独中生
> **项目定位**：马来西亚华文独立中学（董总 UEC 高中统考理科标准）打造的高性能、免维护单页 Web App 题库与刷题平台。  
> **线上访问地址**：`https://science-subjects-question.vercel.app/`  
> **GitHub 仓库**：`https://github.com/K316-M/Science_Subjects_Question` (Private 仓库)

---

## 一、目前已实现的功能与架构现状 (Current State)

### 1. 宿主与部署环境
* **托管服务**：Vercel（关联 GitHub Private 仓库，代码保密，网址完全对外公开）。
* **自动化触发**：主分支（`main`）每次产生 Commit，Vercel 会在 5~10 秒内秒级完成热更新发布。

### 2. 前端架构 (`index.html`)
* **设计风格**：大自然浅色薄荷渐变护眼系（Natural Fresh Light Theme），告别压抑暗黑风。
* **数据驱动**：前端为纯静态单页容器，通过 `fetch('./papers/<subject>_question_bank.json')` 异步拉取题库数据并动态渲染，题目增加/修改无需触动 HTML 核心逻辑。
* **一级书签导航（PPT 竖型大纲轨道）**：
  * 进入学科【生物】后，顶部渲染可横向平滑滚动的“第 1 章 ~ 第 19 章”立体竖型书签卡。
* **二级子书签切换**：
  * 包含 `🎴 选择题练习` 与 `📝 综合做答题` 两个胶囊分类按钮，杜绝长页面无限向下滚屏。
* **做答题排版与翻转闪卡（Flip Card）**：
  * 采用类似 Google Forms 的独立大白卡排版，卡片间距舒适。
  * 答案区域带有**「🙈 遮挡背诵 / 📖 掀开核对」**折叠机制，提升背书复习效率。
  * 具备荧光标色工具（黄/绿/粉），基于 `localStorage` 实现划线重点记忆与状态持久化。
* **选择题答对锁定机制**：
  * 选错提示红框并允许重选；**一旦点选正确答案立即变绿锁定（Freeze）**，无法改选并自动展开深度学术解析。
* **原生交互音效引擎**：
  * 基于 Web Audio API 纯代码实时震荡合成（Pop 气泡声、Correct 清脆大三和弦、Wrong 低音提醒、Flip 翻页声），零外部音频依赖，支持右上角一键静音。

### 3. 数据层现状 (`papers/`)
* `biology_question_bank.json`：已完成董总官方 19 章框架的搭建与首批真题映射，题干去除了静态试卷的题号，作答题具备唯一 ID 用于划线绑定。
* `chemistry_question_bank.json`及`chemistry_question_bank.json`：已建立空文档。
* `math_question_bank.json`：尚未创建
---

## 二、近期目标 (Near-term Goals)

| 任务模块 | 具体需求说明 | 优先级 |
|---|---|---|
| **三科动态解耦切换** | 在前端导航首页，点击“生物”、“化学”、“物理”能动态加载对应的 JSON 文件，统一采用一套渲染器。根据All_chapter.md完成章节布置 | P0 (紧急) |
| **真题高清切图管理** | 逐步淘汰手绘粗糙的 SVG，支持在 JSON 中配置 `"image": "./images/xxx.jpg"`，配合前端内置灯箱（Lightbox）实现点击放大查看原图细节。 | P1 |
| **做题记录与错题本** | 利用 `localStorage` 记录各章节选择题的答题正误状态，在书签卡上直观显示已完成进度（如 `5/10 已掌握`）。 | P2 |

---

## 三、终极目标：零人工干预的“全自动采纳与发布”流水线 (Ultimate Goal)

这是本项目的**核心终极愿景**：管理员不需要每次开电脑或手写 JSON，实现全自动的“试卷摄入 ➔ AI 质检编排 ➔ 管理员在手机/网页端一键决定是否公开”。

### 🔄 终极自动化闭环工作流 (Architectural Pipeline)

```text
[ 用户端 / 管理员 ]
  1. 手机拍照试卷 (JPG/PNG) 或 直接粘贴题目文字
  2. 丢入仓库的 drafts/ 目录，或在网页后台“录题框”直接提交
                         ↓
[ GitHub Actions / Cloud AI Agent ]
  3. 自动触发多模态审题引擎（Gemini 1.5 Pro / Flash）
  4. 自动去除题号、规范化选项、核算标准答案、编写考点解析
  5. 将图片精准裁剪、自动归类到董总标准章节体系
  6. 运行自检巡检（检查是否有缺少配图、死链、答案争议）
  7. 自动生成独立的 PR（Pull Request）或草稿待审 JSON
                         ↓
[ 管理员审核网关 (Admin Review Gate - 必须由管理员掌控) ]
  8. 管理员手机收到通知，打开“待审预览页面”
  9. 查看 AI 整理的题目排版、配图与《题库质检报告》
  10. 管理员点击【✅ 批准发布】或【✏️ 微调后发布】
                         ↓
[ 自动发布上线 ]
  11. 触发自动 Merge，更新 papers/ 目录下的正式题库 JSON
  12. Vercel 监听到正式变更，5 秒内完成线上部署，正式对所有学生公开！
```

---

## 四、给 Claude Code 的具体执行任务分解 (Action Items for Claude Code)

当你作为 Claude Code 接手本项目时，请按照以下顺序执行工程构建：

1. **改造 `index.html` 的学科加载路由**：
   - 彻底解开化学与物理卡片的置灰状态。
   - 编写通用的 `openSubject(subjectId)` 路由函数，根据参数动态 fetch `/papers/biology_question_bank.json`、`/papers/chemistry_question_bank.json` 与 `/papers/physics_question_bank.json`。
2. **编写 GitHub Actions 自动化录题工作流 (`.github/workflows/ingest_paper.yml`)**：
   - 监听 `drafts/` 文件夹中的新考卷图片上传。
   - 自动运行 Python 脚本，调用多模态模型把原卷图片转写为符合 Schema 的题目对象。
   - 自动检测题目中是否包含“如图所示”但未提供配图的情况，输出清晰的审核报告。
3. **实现审核网关（Review & Approval）**：
   - 将 AI 整理后的题目暂存为 `papers/pending_approval.json`，在前端加入仅管理员可见的“待审核题目面板”或通过 GitHub PR 机制，方便管理员在手机上一键点击 Approve 即可合并入正式题库。
4. **设计、体验感美化**：
   - 将网站首页设计多一点，可放动画或理科元素插画
   - 将原本生物、化学、物理学科背景各放免费插图，渐浅式的放在背景
   - 音效可以多一些，背景音乐可以参考各科目网络上有名的纯音乐套入
   - *可选择 添加专属用户机制，让每个用户能登陆自己的google账号（若可以，不然就是建立网页数据库且必须有保障），这样能让他们保留自己的笔记
