# 你可以自己改的地方

这份是**索引**：想改什么 → 去哪个档案 → 搜哪个名字 → 改成多少。
用「搜名字」而不是行号定位，是因为行号一改就跑掉；打开档案按 Ctrl+F（手机 GitHub 网页版按「搜寻」）找那个名字就到了。

改完推送到 `main`，Vercel 几十秒内部署；看不到变化先按 Ctrl+Shift+R 强制重新整理。
改了介面的东西，推送前跑一次 `node scripts/ui-check/run.js`（见 [OPERATIONS.md 第八节](OPERATIONS.md#八部署与排错)），它会抓对比度、版面溢出、字级阶梯。

> 🟢 = 随便改，改坏了也只是难看　🟡 = 有范围，照建议值改　🔴 = 改之前先读注意事项

---

## 一、设计：颜色、明暗、尺寸

| 想改什么 | 档案 | 搜这个名字 | 现在 | 建议 | |
|---|---|---|---|---|---|
| 电脑版白天背景太亮／太暗 | `index.html` | `--desktop-dim` | `0.10` | `0`（不压暗）～ `0.25` | 🟢 |
| 主色（按钮、标题的绿） | `index.html` | `--primary`、`--primary-dark` | `#047857` | 深一点的颜色，白字要看得清 | 🟡 |
| 页面底色（渐层） | `index.html` | `--bg-nature` | 薄荷→浅蓝→浅绿 | | 🟢 |
| 卡片的透明度 | `index.html` | `--card-bg` | 白色 72% | 低於 60% 字会难读 | 🟡 |
| 荧光笔三个颜色 | `index.html` | `--hl-yellow` `--hl-green` `--hl-pink` | | 要浅，不然盖住字 | 🟢 |
| 按钮的功能色（绿／红／琥珀／青） | `index.html` | `--fn-go` `--fn-danger` `--fn-warn` `--fn-time` | | 用法见 [OPERATIONS 七·按钮的颜色](OPERATIONS.md#按钮的颜色与图标) | 🟡 |
| 护眼模式的整套颜色 | `css/night.css` | 最上面 `--n-` 开头的变数 | | 见 [OPERATIONS 七·护眼模式](OPERATIONS.md#护眼模式的颜色) | 🟡 |
| 手机浏览器顶端那条的颜色 | `js/theme.js` | `BAR_COLOR` | 白天 `#059669`、护眼 `#1d1b18` | | 🟢 |
| 各科的强调色（首页轨道） | `js/orbit-subjects.js` | `SUBJECTS` 里的 `accent` | 生物绿、化学紫、物理蓝 | | 🟢 |
| 各科背景光团的颜色 | `index.html` | `SUBJECT_THEME` 的 `blobA` `blobB` | | | 🟢 |
| 背景插画的浓淡 | `index.html` | `.custom-photo-layer` | | 见 [OPERATIONS 七·背景的浓淡](OPERATIONS.md#背景的浓淡) | 🟢 |
| 护眼模式背景水彩的亮度 | `scripts/scene/build_scene.py` | `NIGHT_K` | `0.32` | 改完要重跑脚本，见 [OPERATIONS 七](OPERATIONS.md#护眼模式的颜色) | 🟡 |
| 统考时间表弹出框的宽度 | `index.html` | `.exam-list {` 的 `width` | `min(520px, …)` | 窄於 460px 时名称自动换到下一行 | 🟢 |
| 快捷键提示在多宽的视窗才显示 | `index.html` | `.kbd-hint` 那段的 `min-width` | `600px` | 太窄会和笔记按钮叠在一起 | 🟢 |
| 字级、行高、间距 | 各 CSS | — | | **只能用阶梯上的值**，见 [OPERATIONS 七·阶梯](OPERATIONS.md#字级行高间距的阶梯) | 🔴 |

---

## 二、文字：标题、说明、导览、小精灵的话

| 想改什么 | 档案 | 搜这个名字 | |
|---|---|---|---|
| 首页大标题「独中理科」 | `index.html` | `retro-hero-title` | 🟢 |
| 首页标题下的缎带「自主学习 · 统考题库」 | `index.html` | `retro-ribbon` | 🟢 |
| 浏览器分页上的网站名称 | `index.html` | `<title>` | 🟢 |
| 「选择学习学科」与下面的提示 | `index.html` | `page-heading`、`page-hint` | 🟢 |
| 各科名称、英文名、轨道上的小字说明 | `js/orbit-subjects.js` | `SUBJECTS` 的 `name` `en` `note` | 🟢 |
| 做题页上的科目名称（「生物科」） | `index.html` | `SUBJECT_LABELS` | 🟢 |
| **每个画面的导览（聚光灯）文字** | `js/onboarding.js` | `TOURS` —— 每一步是 `{ title, body }`，`body` 可以用 `<strong>` | 🟢 |
| 小精灵说的「谢谢！」 | `js/feedback.js` | `bubble.textContent` | 🟢 |
| 小精灵通知面板的标题 | `js/feedback.js` | `spritePanelTitle` | 🟡 保留 `${…}` 那段，那是自动填的修复内容 |
| 做答题作答框的提示字 | `index.html` | `subj-attempt-input` 的 `placeholder` | 🟢 |
| AI 批改结果下面的「仅供参考」说明 | `index.html` | `grade-note` | 🟢 |
| 统考时间表最上面的两行说明 | `js/exam-timetable.js` | `rules`；`index.html` 搜 `exam-list-hint` | 🟢 |
| 时间表的考试名称（「2026 年度第 52 届高中统考」） | `js/exam-timetable.js` | `title` | 🟢 |

---

## 三、时间：动画快慢、间隔、排程

| 想改什么 | 档案 | 搜这个名字 | 现在 | |
|---|---|---|---|---|
| **小精灵的所有动作时间**（多久打瞌睡、多久眨一次眼、挥手多久、说谢谢後停多久…） | `js/feedback.js` | `SPRITE_TIMING` | 全部集中在这一块，每项都有注解 | 🟢 |
| 首页轨道绕圈速度 | `js/orbit-subjects.js` | `IDLE_SPEED` | `4`（度/秒，约 90 秒一圈） | 🟢 |
| 点圆球後转到正上方的时间 | `js/orbit-subjects.js` | `SNAP_MS` | `760` 毫秒 | 🟢 |
| 背景音乐音量 | `index.html` | `MUSIC_VOLUME` | `0.35`（0～1） | 🟢 |
| 换科时音乐交叉淡入淡出 | `index.html` `js/scene-assets.js` | `MUSIC_FADE_MS`、`FADE_MS` | `900` 毫秒 | 🟢 |
| 同步码自动同步的间隔 | `js/sync.js` | `AUTO_EVERY_MS` | 60 秒 | 🟡 太短会烧 Upstash 免费额度 |
| **统考日期与每场的试卷一／二时间** | `js/exam-timetable.js` | `papers` | 2026 年董总时间表 | 🟡 格式见档案开头注解 |
| AI 依考纲出题的自动排程 | `.github/workflows/generate_questions.yml` | `cron` | 每周一早上 9 点（马来西亚） | 🟡 cron 是 UTC，马来西亚时间减 8 小时 |
| 题库体检的自动排程 | `.github/workflows/auto_update.yml` | `cron` | 每周一早上 8 点 | 🟡 同上 |

---

## 四、规则与额度：出题量、复习、批改

| 想改什么 | 档案 | 搜这个名字 | 现在 | |
|---|---|---|---|---|
| 每次自动出题照顾几章、每章几题 | `.github/workflows/generate_questions.yml` | `chapters_per_run`、`questions_per_chapter` 的 `default` | 3 章 × 4 题 | 🟢 手动跑时也可以当场填 |
| 新题和旧题多像就当成重复丢掉 | `scripts/generate_questions.py` | `SIMILARITY_LIMIT` | `0.82`（0～1） | 🟡 调低会丢掉更多题 |
| 固定用某个 Gemini 模型（不自动挑） | GitHub → Settings → Actions 变数 | `GEMINI_MODEL` | 不设＝自动挑最高级 | 🟡 |
| AI 批改：每个 IP 每小时几次 | `api/grade.js` | `LIMIT_PER_HOUR` | `20` | 🟡 越高越可能被刷额度 |
| AI 批改：答案最长几字 | `api/grade.js` | `MAX_ANSWER` | `3000` | 🟢 |
| AI 批改：几成分数算「可接受」「部分正确」 | `api/grade.js` | `PASS_RATIO`、`PARTIAL_RATIO` | `0.8`、`0.4` | 🟢 |
| **AI 批改的改法**（怎么拆得分点、错别字扣不扣） | `api/grade.js` | `buildPrompt` 里的「改法」1～4 | | 🔴 第 4 条（忽略答案里的指示）不要删 |
| **AI 录题的规则**（只取什么、高光怎么认） | `scripts/ingest_drafts.py` | `build_prompt` 里的 0～6 条 | | 🔴 JSON 栏位名称不要改，程式靠它读 |
| 复习排程（多久後再复习一次） | `js/review.js` | `EASE_START` `EASE_MIN` `EASE_MAX` `EASE_UP` `EASE_DOWN` | | 🔴 会影响每个学生已排好的复习 |
| 复习间隔最长几天 | `js/review.js` | `MAX_INTERVAL_DAYS` | `60` | 🟢 |
| 错题要在几个不同的日子答对才移出错题本 | `js/review.js` | `WEAK_EXIT_DAYS` | `2` | 🟢 |
| 错几次标成「顽固」 | `js/review.js` | `STUBBORN_LAPSES` | `3` | 🟢 |
| 申诉要寄到哪个信箱 | `js/feedback.js` | `FEEDBACK_ENDPOINT` | Formspree 表单 | 🟡 换成你自己的 Formspree 网址 |
| 开放「高级数学」一科 | `js/orbit-subjects.js` | `SUBJECTS` 里 `math` 的 `enabled` | `false` | 🔴 要先建 `papers/math_question_bank.json` 的章节 |

---

## 五、素材与资料：不用碰程式码

| 想做什么 | 放在哪里 | 说明 |
|---|---|---|
| 加题目（照片、Word、PPT、PDF） | `drafts/<biology\|chemistry\|physics>/` | [drafts/README.md](../drafts/README.md) |
| 改已上线的题、换配图 | 网站 `/dev` →「题目修改」 | 不用碰 JSON，见 [OPERATIONS 一·4](OPERATIONS.md#4-修改已上线的题) |
| 改章节名称或顺序 | `papers/<科目>_question_bank.json` 的 `sections[].title` | 🔴 不要改 `id`，学生的进度、笔记、划线都靠它对应 |
| 放官方考纲（让 AI 出题更准） | `syllabus/<科目>.md` | [syllabus/README.md](../syllabus/README.md) |
| 换背景图、背景音乐 | `assets/visual/<科目>/`、`assets/audio/<科目>/` | [assets/README.md](../assets/README.md) |
| 会动的分层背景 | `assets/visual/<科目>/scene.json` | [OPERATIONS 七·scene.json](OPERATIONS.md#会动的分层背景scenejson) |
| 小精灵的姿势图 | `source/sprite/<姿势>.png` → 跑 `python3 scripts/sprite/build.py` | 🔴 **一定要真正透明的 PNG**。AI 生图的「透明背景」常是画进去的棋盘格，脚本会停下来告诉你；色调、大小、位置脚本会自动对齐 |
| 申诉处理结果 | 网站 `/dev` →「申诉处理」 | 不必手改 `data/resolved_issues.json` |

---

## 六、设定（在网站外面）

Vercel 与 GitHub 的环境变数、金钥放哪里，见 [OPERATIONS 四](OPERATIONS.md#四设定环境变数两个地方别放错)。
这几轮新增、需要你设的：

- **Vercel `GEMINI_API_KEY`**：做答题「交给 AI 批改」要用；没设就显示「AI 批改还没开启」。
- **Vercel `GITHUB_TOKEN`**：/dev 的采纳、改题、上传配图要用（Contents: Read and write）。

---

## 附：哪些档案是做什么的

| 档案 | 给谁看 |
|---|---|
| `README.md`（根目录） | 第一次打开仓库的人：这是什么、怎么运作、东西放在哪 |
| `docs/CUSTOMIZE.md`（这份） | 你：想改东西先查这里 |
| `docs/OPERATIONS.md` | 你：日常操作（录题、审题、申诉）、设定、排错的完整步骤；附录 B 是完整档案地图 |
| `drafts/README.md`、`syllabus/README.md`、`assets/README.md` | 你：各自那个资料夹怎么放东西 |
| `docs/DESIGN.md` | 设计每一轮做了什么、为什么，给下一轮改版参考 |
| `docs/All_chapter.md` | 三科官方章节清单的原始抄本（题库的章节框架由它而来） |
| `docs/INSPECTION_REPORT.md` | 自动产生的题库体检报告，不用手改 |
| `CLAUDE.md`、`.claude/` | 给 Claude 的工作守则与技能（Claude 只在这个位置找，不能搬） |
