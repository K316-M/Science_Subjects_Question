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
| 各科的强调色（首页轨道） | `js/orbit-subjects.js` | `SUBJECTS` 里的 `accent` | 生物绿、化学紫、物理蓝、数学琥珀 | | 🟢 |
| 各科背景光团的颜色 | `index.html` | `SUBJECT_THEME` 的 `blobA` `blobB` | | | 🟢 |
| 背景插画的浓淡 | `index.html` | `.custom-photo-layer` | | 见 [OPERATIONS 七·背景的浓淡](OPERATIONS.md#背景的浓淡) | 🟢 |
| 护眼模式背景水彩的亮度 | `scripts/scene/build_scene.py` | `NIGHT_K` | `0.32` | 改完要重跑脚本，见 [OPERATIONS 七](OPERATIONS.md#护眼模式的颜色) | 🟡 |
| 网站图标（原子＋书）的颜色：导航列中间的徽章、首页轨道中心 | `index.html`（白天）、`css/night.css`（护眼） | `--logo-orbit`（轨道、电子）`--logo-core`（原子核）`--logo-page`（书页）`--logo-cover`（封面） | 白天 `#0c88ea` `#fbaa1c` `#65b9fc` `#114889`；护眼 `#8bbbe6` `#e2ab54` `#6c9bcc` `#4a7ab0` | 护眼那组别用白天的深蓝，封面会在深底上看不见；首页球心会跟著科目变色（物理是蓝的），改完看一下物理 | 🟢 |
| 护眼模式的笔记画布颜色 | `css/night.css` | `--n-note-paper` | `#2c2924`（深色纸） | 调亮要重算下面五支笔的对比，别低於 4.5:1 | 🟡 |
| 护眼模式的五支笔颜色 | `js/notes.js` | `NIGHT_INK` | 黑→米白、红→`#fb7185`、蓝→`#7cb4ff`、绿→`#4fd1a5`、橙→`#f7c35c` | 只改右边（夜间色）就好 | 🔴 左边要跟 `index.html` 五个色点的 `data-ink` 一样；以後改白天笔色时，旧颜色那一列要留著（旧笔记存的是旧颜色，删掉的话夜里会变回深色、看不见） |
| 直式背景（手机、平板、iPad 横放）底图最多露出多宽 | `js/scene-assets.js` | `TALL_PLATE_SPAN` | `0.62`（底图中间 62%） | 调大：iPad 横放、5:4 屏幕会冒出第二个透镜／分子团；调小：底图放大变糊、下方山丘变大。改完要看 1024×768 和 1280×1024 | 🟡 |
| 数学公式的字比内文大多少 | `js/math-render.js` | `KATEX_TUNING` 里的 `font-size` | `1.1em`（KaTeX 预设 `1.21em`） | 太大夹在中文里很抢；题目档「打印版」另有一份，在 `js/archive.js` 搜 `.katex{font-size` | 🟢 |
| 数学的分数、积分、Σ 排成全尺寸（像试卷） | `js/math-render.js` | `preProcess` | 每条公式前加 `\\displaystyle` | 拿掉就变回 KaTeX 预设的行内小分数，手机上很难看清 | 🟢 |
| 统考时间表弹出框的宽度 | `index.html` | `.exam-list {` 的 `width` | `min(520px, …)` | 窄於 460px 时名称自动换到下一行 | 🟢 |
| 换题时题卡左右滑进来的距离 | `index.html` | `slideFromRight`、`slideFromLeft` | `12px` | 不要超过 `16px`（手机的页边） | 🔴 超过的话，滑进来那几格会超出萤幕，手机浏览器把整页撑宽、之後一直能左右晃 |
| 快捷键提示在多宽的视窗才显示 | `index.html` | `.kbd-hint` 那段的 `min-width` | `600px` | 太窄会和笔记按钮叠在一起 | 🟢 |
| /dev 列表（巡检、待审、题目修改）题与题之间的空隙 | `dev/dev.css` | `--list-gap` | `12px` | 每题一张卡；太小又会看起来连在一起 | 🟢 |
| 字级、行高、间距 | 各 CSS | — | | **只能用阶梯上的值**，见 [OPERATIONS 七·阶梯](OPERATIONS.md#字级行高间距的阶梯) | 🔴 |

---

## 二、文字：标题、说明、导览、小精灵的话

| 想改什么 | 档案 | 搜这个名字 | |
|---|---|---|---|
| 首页大标题「独中理科」 | `index.html` | `retro-hero-title` | 🟢 |
| 首页标题下的缎带「备考题库 · 复习系统」 | `index.html` | `retro-ribbon` | 🟢 |
| **网站名称「独中理科复习网」**（浏览器分页、分享网址的预览、装到手机桌面的名称） | `index.html`、`manifest.json`、`dev/index.html` | `index.html` 的 `<title>`、`og:title`、`apple-mobile-web-app-title`；`manifest.json` 的 `name`、`short_name`；`dev/index.html` 的 `side-brand-text` | 🟡 六处一起改才一致。桌面图示下的短名（`short_name`、`apple-mobile-web-app-title`，现在「理科复习网」）最多约 5 个中文字，再长会被截断 |
| 网站的一句话说明（Google 搜寻结果、分享网址的预览、装到手机桌面） | `index.html`、`manifest.json` | `index.html` 的 `name="description"`、`og:description`；`manifest.json` 的 `description` | 🟡 三处一起改才一致；加科目时记得补上科目名 |
| 「选择学习学科」与下面的提示 | `index.html` | `page-heading`、`page-hint` | 🟢 |
| 各科名称、英文名、轨道上的小字说明 | `js/orbit-subjects.js` | `SUBJECTS` 的 `name` `en` `note` | 🟢 |
| 做题页上的科目名称（「生物科」） | `index.html` | `SUBJECT_LABELS` | 🟢 |
| 数学两份卷的名称（按钮「模拟高数Ⅰ · 60 分钟」、/dev 的卷别） | `index.html`、`dev/dev.js` | `PAPER_LABEL` | 🟡 两个档各一份，写一样才对得上 |
| **每个画面的导览（聚光灯）文字** | `js/onboarding.js` | `TOURS` —— 每一步有 title（标题）和 body（内文），内文可以用 `<strong>` | 🟢 |
| 「加到主画面」提示：怎么加（iPhone／Android 各一句）、什么时候跳 | `js/onboarding.js` | `INSTALL_HOW`、`maybeInstallTip` | 🟢 现在是做过题、回到首页、手机或平板、还没装好才跳一次 |
| 同步：提醒只接自己的码（输入框下方、打开同步链结时） | `js/sync-ui.js`、`js/sync.js` | `只贴你自己的`、`只接你自己装置的链结` | 🟢 |
| 小精灵说的「谢谢！」 | `js/feedback.js` | `bubble.textContent` | 🟢 |
| 小精灵通知面板的标题 | `js/feedback.js` | `spritePanelTitle` | 🟡 保留 `${…}` 那段，那是自动填的修复内容 |
| 做答题作答框的提示字 | `index.html` | `subj-attempt-input` 的 `placeholder` | 🟢 |
| AI 批改结果下面的「仅供参考」说明 | `index.html` | `grade-note` | 🟢 |
| AI 讲解、AI 批改等待时按钮上的字（「AI 老师在想…10～20 秒」「批改中…约 10 秒」） | `index.html` | `AI 老师在想`、`批改中…` | 🟡 写实际要等的时间，写短了学生会以为卡住；讲解那颗在 320px 手机上最多约 12 个中文字宽，再长会断成两行 |
| 统考时间表最上面的两行说明 | `js/exam-timetable.js` | `rules`；`index.html` 搜 `exam-list-hint` | 🟢 |
| 时间表的考试名称（「2026 年度第 52 届高中统考」） | `js/exam-timetable.js` | `title` | 🟢 |
| 离线或连不上时按「立即同步」的提示 | `js/sync.js` | `目前没有网络` | 🟢 |
| 章节多了新题时，底部提示框的字（「这一章多了 N 道新题，点我去看」） | `index.html` | `道新题，点我去看` | 🟡 保留 `${…}` 那段，那是自动填的题数；太长在 320px 手机上会断成两行 |
| 巡检 Issue 的标题 | `.github/workflows/auto_update.yml` | `title:`，以及「找还开着的巡检 Issue」那步的 `startswith("🚨 题库巡检")` | 🔴 两处要一起改：标题开头对不上，每次巡检都会另开一个新的 Issue |

---

## 三、时间：动画快慢、间隔、排程

| 想改什么 | 档案 | 搜这个名字 | 现在 | |
|---|---|---|---|---|
| **小精灵的所有动作时间**（多久打瞌睡、多久眨一次眼、挥手多久、说谢谢後停多久…） | `js/feedback.js` | `SPRITE_TIMING` | 全部集中在这一块，每项都有注解 | 🟢 |
| 首页轨道绕圈速度 | `js/orbit-subjects.js` | `IDLE_SPEED` | `4`（度/秒，约 90 秒一圈） | 🟢 |
| 点圆球後转到正上方的时间 | `js/orbit-subjects.js` | `SNAP_MS` | `760` 毫秒 | 🟢 |
| 点「有新题」提示框後，题卡从远处滑到定位的时间 | `index.html` | `NEW_TIP_PAN_MS` | `450` 毫秒 | 🟢 太长会像卡住；开了「减少动态」的装置不滑 |
| 背景音乐音量 | `index.html` | `MUSIC_VOLUME` | `0.35`（0～1，iPhone／iPad 也照这个） | 🟢 |
| 换科时音乐交叉淡入淡出 | `index.html` | `MUSIC_FADE_MS` | `900` 毫秒 | 🟢 `js/scene-assets.js` 的 `FADE_MS` 只管其他独立页面自己的音乐（目前没有这种页面），主网页不看它 |
| 背景音乐的响度、剪静音的门槛、循环接头的淡接秒数 | `scripts/audio/build.py` | `LUFS`、`SILENCE_DB`、`XFADE` | `-20`、`-50`、`3.0` 秒 | 🟡 改完到 Actions 手动跑「背景音乐自动处理」、科目留空，全部重做；只重做一首会和其他首不一样大声 |
| 音乐播完接回开头时，头尾交叉叠多久 | `index.html` | `MUSIC_LOOP_XFADE_MS` | `3000` 毫秒 | 🟢 太长会听到结尾和开头叠在一起；曲子短于它的 3 倍就不叠，直接重播 |
| 同步码自动同步的间隔 | `js/sync.js` | `AUTO_EVERY_MS` | 60 秒 | 🟡 太短会烧 Upstash 免费额度 |
| 待在做题页、或从背景切回来时，多久检查一次题库有没有更新 | `index.html` | `BANK_RECHECK_MS` | 10 分钟 | 🟢 题库没变时伺服器只回「没变」，几乎不花流量；有变就跳「题库更新了」 |
| **统考日期与每场的试卷一／二时间** | `js/exam-timetable.js` | `papers` | 2026 年董总时间表 | 🟡 格式见档案开头注解 |
| AI 依考纲出题的自动排程 | `.github/workflows/generate_questions.yml` | `cron` | 每周一早上 9 点（马来西亚） | 🟡 cron 是 UTC，马来西亚时间减 8 小时 |
| 题库体检的自动排程 | `.github/workflows/auto_update.yml` | `cron` | 每周一早上 8 点 | 🟡 同上 |

---

## 四、规则与额度：出题量、复习、批改

| 想改什么 | 档案 | 搜这个名字 | 现在 | |
|---|---|---|---|---|
| 每次自动出题照顾几章、每章几题 | `.github/workflows/generate_questions.yml` | `chapters_per_run`、`questions_per_chapter` 的 `default` | 3 章 × 4 题 | 🟢 手动跑时也可以当场填 |
| 新题和旧题多像就当成重复丢掉 | `scripts/generate_questions.py` | `SIMILARITY_LIMIT` | `0.82`（0～1） | 🟡 调低会丢掉更多题 |
| 每周自动出题：待审区还有几道 AI 题没审完就先不出 | `scripts/generate_questions.py` | `PAUSE_WHEN_WAITING` | `1`（有 1 道就不出） | 🟢 `0`＝不管，照样出；手动跑不受影响 |
| 离线用：网站装好後先下载哪些档案 | `sw.js` | `OFFLINE_EXTRAS` | 四科题库＋数学公式排版（约 550KB） | 🟡 学生第一次打开就会下载；背景图（每科约 250KB）、音乐（每科约 2MB）要加进来前先想想学生的流量 |
| 出题不用哪一级模型（较强的都用完就停手，不往下退） | `scripts/generate_questions.py` | `GENERATE_SKIP_TIERS` | `("flash-lite",)` | 🟡 `()`＝照样退到最後一级，题目品质差很多；录题不受影响。想固定用某个模型设 `GEMINI_MODEL` |
| 录题／出题推进待审区时被抢先（/dev 刚采纳）最多重试几次 | `scripts/push_pending.sh` | `TRIES` | `5` | 🟢 通常用不到；全部失败就重跑那个工作流（原档还在 drafts/） |
| 固定用某个 Gemini 模型（不自动挑） | GitHub → Settings → Actions 变数 | `GEMINI_MODEL` | 不设＝自动挑最高级 | 🟡 |
| AI 批改：每台装置每小时几次 | `api/grade.js` | `LIMIT_PER_HOUR` | `20` | 🟡 越高越可能被刷额度；学生在做答题下方看得到剩几次 |
| AI 批改：同一个网络（例如全校 Wi-Fi）每小时合计几次 | `api/grade.js` | `NETWORK_LIMIT_PER_HOUR` | `200` | 🟡 全校一起用时不够就调高 |
| AI 批改：答案最长几字 | `api/grade.js` | `MAX_ANSWER` | `3000` | 🟢 |
| AI 批改：几成分数算「可接受」「部分正确」 | `api/grade.js` | `PASS_RATIO`、`PARTIAL_RATIO` | `0.8`、`0.4` | 🟢 |
| AI 讲解（选择题「讲给我听」）：每台装置每小时几次 | `api/explain.js` | `LIMIT_PER_HOUR` | `30` | 🟡 和批改分开计 |
| AI 讲解：同一个网络每小时合计几次 | `api/explain.js` | `NETWORK_LIMIT_PER_HOUR` | `300` | 🟡 |
| AI 讲解全班共用的快取存多久 | `api/_lib/ai.js` | `EXPLAIN_TTL_SECONDS` | 180 天 | 🟢 |
| AI 讲解在装置上最多存几则 | `index.html` | `EXPLAIN_KEEP` | `300` | 🟢 超过就丢最旧的 |
| **AI 讲解的讲法**（多长、先讲什么） | `api/explain.js` | `buildPrompt` 里的「要求」1～4 | | 🔴 第 4 条（不可推翻正确答案）不要删 |
| 模拟统考一份几题 | `index.html` | `MOCK_QUESTIONS`；个别科目在 `MOCK_QUESTIONS_BY_SUBJECT` | 理科 `40`；数学 `15`（高数Ⅰ、Ⅱ 评量规格） | 🟡 时间照统考时间表的试卷一；题库不够就按比例缩短。真卷题数不同就改这里 |
| 模拟统考对到时间表的哪一科 | `index.html` | `EXAM_SUBJECT` | 数学用 `'math:I'`→`高级数学（Ⅰ）`、`'math:II'`→`高级数学（Ⅱ）` | 🔴 右边要和 `js/exam-timetable.js` 的 `subject` 一字不差（全形括号、罗马数字 Ⅰ Ⅱ），对不上按钮就不出现 |
| 没标卷别的数学题，哪几章不进高数Ⅰ | `index.html` | `MATH_ADVANCED_CHAPTERS` | 第 30、31、33、34、35 章（《高级数学》才有） | 🔴 写章节 `id`（`chap30`），不是章名；课程标准改版才动 |
| 数学卷别的代号 | `api/_lib/questions.js`、`scripts/ingest_drafts.py`、`scripts/check_repo.py` | `PAPERS` | `'I'`、`'II'` | 🔴 三处一起改；题库里存的就是这两个字，改了，已经标好的题全部对不上 |
| 照片档名怎么认高数Ⅰ／Ⅱ（第二页以後没有卷头时） | `scripts/ingest_drafts.py` | `PAPER_IN_FILENAME` | 「高数2」「高数Ⅱ」「SC07」→ Ⅱ；「高数1」「SC06」→ Ⅰ | 🟡 Ⅱ 要排在前面（「高数II」也含「高数I」） |
| **AI 批改的改法**（怎么拆得分点、错别字扣不扣） | `api/grade.js` | `buildPrompt` 里的「改法」1～4 | | 🔴 第 4 条（忽略答案里的指示）不要删 |
| **AI 录题的规则**（只取什么、高光怎么认） | `scripts/ingest_drafts.py` | `build_prompt` 里的 0～6 条；数学另加 `MATH_INGEST_RULES`（认卷别） | | 🔴 JSON 栏位名称不要改，程式靠它读 |
| **数学公式的写法**（录题、出题 AI 共用：LaTeX、符号照公式表） | `scripts/qa.py` | `MATH_RULES` | | 🔴 「反斜线写两次」「不要直接打 < >」两条不要删；改了符号写法，`syllabus/math.md` 最後一段也要一起改 |
| **生物、化学、物理的公式写法**（录题、出题 AI 共用：简单的打符号，复杂的才用 `$…$`） | `scripts/qa.py` | `FORMULA_RULES` | | 🟡 「`$` 外面不可以出现反斜线指令」「反斜线写两次」不要删，不然学生会看到 `\sqrt` 原始码 |
| 哪些字算 AI 自言自语（标「⚠️ …多半算错」） | `scripts/qa.py`、`dev/dev.js` | `SELF_TALK` | 等等、哎呀、重新计算、让我们重新…、慢，检查 | 🔴 两个档要一起改（录题出题时标一次、/dev 打开时再查一次，字句不同会重复显示）；只加正常解析不会出现的字，「不对，」「慢，」会误中「B 不对，因为…」「反应极慢，…」 |
| 网站 AI 讲解、批改的数学公式写法 | `api/_lib/ai.js` | `MATH_PROMPT_RULE` | | 🟡 要叫它用 `$…$` 包 LaTeX，学生站才排得出公式 |
| 网站 AI 讲解、批改的生物、化学、物理公式写法 | `api/_lib/ai.js` | `FORMULA_PROMPT_RULE` | 简单的打符号，复杂的才用 `$…$` | 🟡 和出题、录题的 `FORMULA_RULES`（`scripts/qa.py`）同一套写法，改一边另一边也要跟上 |
| AI 少写反斜线时自动补回的 LaTeX 指令（\\frac、\\theta 这类） | `scripts/qa.py`、`api/_lib/ai.js` | `LATEX_ESCAPE_LOOKALIKES` | 只列 b、f、n、r、t 开头的指令 | 🔴 两个档要一起改；不要加 `ne`、`nu`、`ni`（和「换行＋字母」分不出来） |
| 复习排程（多久後再复习一次） | `js/review.js` | `EASE_START` `EASE_MIN` `EASE_MAX` `EASE_UP` `EASE_DOWN` | | 🔴 会影响每个学生已排好的复习 |
| 复习间隔最长几天 | `js/review.js` | `MAX_INTERVAL_DAYS` | `60` | 🟢 |
| 错题要在几个不同的日子答对才移出错题本 | `js/review.js` | `WEAK_EXIT_DAYS` | `2` | 🟢 |
| 删掉的笔记要记住多久（防止另一台装置同步回来） | `js/sync.js` | `NOTE_TOMBSTONE_DAYS` | `365` | 🟢 |
| 错几次标成「顽固」 | `js/review.js` | `STUBBORN_LAPSES` | `3` | 🟢 |
| 合并前检查挡哪些问题（每个 PR 自动跑） | `scripts/check_repo.py` | 最上面的说明 1～5，对应 `check_bank`、`check_pending`、`check_python`、`check_js`、`check_customize` | 只挡会让网站坏掉的 | 🟡 提醒类（缺解析、疑似缺图）放 /dev 巡检，别加在这里，不然每个 PR 都是红的 |
| 申诉要寄到哪个信箱 | `js/feedback.js` | `FEEDBACK_ENDPOINT` | Formspree 表单 | 🟡 换成你自己的 Formspree 网址 |
| 暂时关掉某一科（首页那颗球变灰、点不进去） | `js/orbit-subjects.js` | `SUBJECTS` 里那一科的 `enabled` | 四科都是 `true`（数学已开放） | 🟡 改 `false` 时 `note` 写「尚未开放」；要打开的科目，`papers/<科目>_question_bank.json` 要先有章节 |

---

## 五、素材与资料：不用碰程式码

| 想做什么 | 放在哪里 | 说明 |
|---|---|---|
| 加题目（照片、Word、PPT、PDF） | `drafts/<biology\|chemistry\|physics\|math>/` | [drafts/README.md](../drafts/README.md)；数学高数Ⅰ、Ⅱ 都放 `drafts/math/` |
| 改已上线的题、换配图、下架不要的题 | 网站 `/dev` →「题目修改」 | 不用碰 JSON，见 [OPERATIONS 一·4](OPERATIONS.md#4-修改已上线的题) |
| 改章节名称或顺序 | `papers/<科目>_question_bank.json` 的 `sections[].title` | 🔴 不要改 `id`，学生的进度、笔记、划线都靠它对应 |
| 放官方考纲（让 AI 出题更准） | `syllabus/<科目>.md` | [syllabus/README.md](../syllabus/README.md) |
| 换背景图 | `assets/visual/<科目>/` | [assets/README.md](../assets/README.md) |
| 换背景音乐 | `source/audio/<科目>/ambient.mp3`（上传就好） | 🟢 「背景音乐自动处理」工作流会剪静音、做无缝循环、调音量，推到 `assets/audio/`；档名一定要叫 `ambient` |
| 换网页图标（浏览器分页、装到手机桌面） | `assets/icons/` 的 5 个档：`favicon-16x16.png`、`favicon-32x32.png`（分页）、`apple-touch-icon.png`（iPhone 桌面）、`android-chrome-192x192.png`、`android-chrome-512x512.png`（Android 桌面） | 🟡 档名不变、直接覆盖就好（`index.html`、`dev/index.html`、`dev/login.html`、`manifest.json` 都指到这些档名）。分页那两张要先把多余白边裁掉再缩，不然 16px 只剩一团色块。浏览器会快取图标，换完可能要重开分页或清快取才看得到。**网页里的徽章**（导航列中间、首页轨道中心、/dev 左上角）是另外重画的 SVG，不会跟著这 5 个档变：🔴 形状在 `index.html` 的 `id="i-logo"` 和 `assets/icons/logo.svg` 各一份，两边要一起改 |
| 会动的分层背景 | `assets/visual/<科目>/scene.json` | [OPERATIONS 七·scene.json](OPERATIONS.md#会动的分层背景scenejson) |
| 数学公式排版程式（KaTeX）换新版 | `vendor/katex/` | 🟡 照 `vendor/katex/README.md` 换掉同名档案；只留 `.woff2` 字型。字型档有增减的话，`sw.js` 的 `KATEX_FONTS` 也要跟着改（离线下载用） |
| 小精灵的姿势图 | `source/sprite/<姿势>.png` → 跑 `python3 scripts/sprite/build.py` | 🔴 **一定要真正透明的 PNG**。AI 生图的「透明背景」常是画进去的棋盘格，脚本会停下来告诉你；色调、大小、位置脚本会自动对齐 |
| 申诉处理结果 | 网站 `/dev` →「申诉处理」 | 不必手改 `data/resolved_issues.json` |

---

## 六、设定（在网站外面）

Vercel 与 GitHub 的环境变数、金钥放哪里，见 [OPERATIONS 四](OPERATIONS.md#四设定环境变数两个地方别放错)。
这几轮新增、需要你设的：

- **Vercel `GEMINI_API_KEY`**：做答题「交给 AI 批改」与选择题「AI 讲给我听」都要用；没设就显示「还没开启」。
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
