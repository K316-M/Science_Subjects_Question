# 独中理科复习网

给马来西亚华文独中生准备 **董总高中统考（UEC）理科** 的练习网站：生物、化学、物理三科题库，照官方章节编排，手机、电脑都能用，也能离线开。

**网站**：<https://science-subjects-question.vercel.app/>　·　**开发者工作台**：[`/dev`](https://science-subjects-question.vercel.app/dev/)（要登录）

> 题库现况：生物 19 章 · 64 道选择题 · 4 道做答题；化学 34 章、物理 24 章的章节框架已建好，题目陆续补上。

---

## 学生可以做什么

| 功能 | 说明 |
|---|---|
| 选择题练习 | 按章练习；选一次就锁定并展开考点解析；看不懂可以按「AI 讲给我听」，依你选的选项讲为什么对或错 |
| 做答题 | 自己打答案，按「交给 AI 批改」，依参考答案的得分点给分，列出每一点有没有答到 |
| 整章测验 | 一次做完整章，交卷才看答案 |
| 模拟统考 | 全科随机抽题，照统考时间表的试卷一时间倒数，时间到自动交卷 |
| 错题本与今日复习 | 答错的题自动收进错题本；依遗忘曲线排复习，要在不同的两天答对才算过关 |
| 笔记 | 每题可以手写、打字做笔记，直接在题目下面展开或收起 |
| 荧光笔 | 在做答题的题干与参考答案上划重点 |
| 题目档 | 勾选章节或题目，整理成 PDF 下载或打印 |
| 统考时间表 | 首页显示最近的一科；点开有全部场次与试卷一／试卷二的时间 |
| 护眼模式 | 深夜读书用的暖色深色主题，跟随系统或手动切换 |
| 同步码 | 不用帐号，用一组同步码（可扫 QR）在手机与电脑之间同步进度与笔记；两边的笔记会合并，不会互相盖掉 |
| 网页问题申诉 | 发现题目或画面有错可以回报；处理好之後，小精灵会飞出来通知 |

## 题目怎么进来

```
你把题目档丢进 drafts/<科目>/          AI 依考纲自动出题（每周一）
（照片、Word、PPT、PDF、文字档）              │
          │                                  │
          ▼                                  ▼
   GitHub Actions：Gemini 转写 ─→ 自动审题（格式、重复、和原档逐字比对、AI 不看答案重做一次）
          │
          ▼
   待审区 papers/pending_approval.json（直接推进去，不开 PR；报告在 Actions 那次执行的摘要）
          │
          ▼
   /dev「AI 录题待审」：有问题的题展开给你改（文字、答案、配图）；没问题的勾选後一键采纳
          │
          ▼
   正式题库 papers/<科目>_question_bank.json ─→ Vercel 自动部署，学生几十秒後看得到
```

AI 产出的每一题都要经过你按「采纳」才会上线。已上线的题在 `/dev`「题目修改」可以直接改或下架，不用碰 JSON（不要直接从 JSON 删题，原因见 [OPERATIONS 一·4](docs/OPERATIONS.md#4-修改已上线的题)）。

## 仓库里有什么

```
index.html · js/ · css/ · assets/ · images/     网站本体（会部署）
papers/ · data/                                 题库与申诉处理结果（网站会读）
api/                                            Vercel 接口：登录、审题、改题、AI 批改与讲解、同步
dev/                                            开发者工作台

drafts/                                         ← 你放要录的题目档
syllabus/                                       ← 你放官方考纲
source/                                         ← 原始素材：小精灵原图、背景参考图、音乐原档、候选曲
scripts/                                        工具：录题、出题、审题、巡检、素材处理
docs/                                           文件（见下面）
```

`source/` 是原稿，`assets/` 是处理好、网站正在用的成品；`scripts/` 里的工具把前者做成後者。
`docs/`、`source/`、`drafts/`、`syllabus/`、`scripts/` 都不会部署到网站（见 `.vercelignore`）。完整档案地图在 [OPERATIONS 附录 B](docs/OPERATIONS.md#附录-b档案地图)。

## 文件

| 想做什么 | 看这份 |
|---|---|
| 改颜色、文字、动画时间、额度 | [docs/CUSTOMIZE.md](docs/CUSTOMIZE.md) —— 所有可以自己改的地方 |
| 录题、审题、处理申诉、设定、排错 | [docs/OPERATIONS.md](docs/OPERATIONS.md) —— 操作手册 |
| 题目档怎么放、高光怎么标答案 | [drafts/README.md](drafts/README.md) |
| 放官方考纲 | [syllabus/README.md](syllabus/README.md) |
| 换背景图与背景音乐 | [assets/README.md](assets/README.md) |
| 设计每一轮改了什么、为什么 | [docs/DESIGN.md](docs/DESIGN.md) |

## 设定

需要的金钥分放两个地方，详细步骤见 [OPERATIONS 第四节](docs/OPERATIONS.md#四设定环境变数两个地方别放错)：

| 放在 | 变数 | 用途 |
|---|---|---|
| Vercel | `DEV_USERNAME` `DEV_PASSWORD` `DEV_SESSION_SECRET` | 开发者工作台登录（必填） |
| Vercel | `GITHUB_TOKEN` | /dev 的采纳、改题、上传配图、发布申诉结果 |
| Vercel | `GEMINI_API_KEY` | 做答题的 AI 批改、选择题的 AI 讲解 |
| Vercel | `UPSTASH_REDIS_REST_URL` `UPSTASH_REDIS_REST_TOKEN` | 跨装置同步、AI 的次数限制 |
| GitHub Actions | `GEMINI_API_KEY` | AI 录题与 AI 出题 |

## 本机预览

```bash
python3 -m http.server 8080      # 浏览器开 http://localhost:8080
```

学生网站的功能都能测；`/api/` 接口（工作台、AI 批改、同步）要部署到 Vercel 才会动。改了介面，推送前跑一次 `node scripts/ui-check/run.js`（第一次先在 `scripts/ui-check/` 跑 `npm install`）。

## 技术

纯静态网页，没有打包步骤；Vercel 托管，`api/` 是 Node 无伺服器函式；题库是 JSON 档，存在这个仓库里。
自动化跑在 GitHub Actions；AI 用 Google Gemini（从 Google 的模型清单自动挑最新、最高级的模型）。
service worker 采「网路优先、快取兜底」，离线也能开上次看过的内容。
