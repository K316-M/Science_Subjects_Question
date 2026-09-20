# 操作手册

这份是「**你自己动手**」的总览。素材（背景图、音乐）与考纲另有专门说明，不在这里重复：

- 换背景与音乐、新页面怎么接素材 → [assets/README.md](assets/README.md)
- 官方考纲怎么放进来 → [syllabus/README.md](syllabus/README.md)

---

## 一、日常：让题目变多

### 1. 拍题录入（你手上的真题）

```
把照片丢进 drafts/biology/  或 drafts/chemistry/  或 drafts/physics/
  ↓ commit + push（用 GitHub 手机 App 上传也行）
自动跑「AI 自动录题流水线」→ 开一个待审 PR
  ↓ 你逐题核对答案、章节、配图
合并 PR
```

- 照片**越清晰越好**，一张可以有多道题
- 处理过的原图会自动移到 `drafts/<科目>/_processed/`
- 转写结果进 `papers/pending_approval.json`（**待审区**），不会直接上线
- PR 内文就是转写报告，哪几题需要人工裁图、哪几题疑似漏了配图都会标出来

### 2. AI 依考纲出题（原创练习题）

每周一早上 9 点（马来西亚时间）自动跑一次，也可以随时手动触发：

```
GitHub → Actions → 「AI 依考纲出题 (Generate Questions)」→ Run workflow
```

手动触发可以指定三个参数：

| 参数 | 意思 | 建议 |
|---|---|---|
| `subject` | 只为某一科出题（留空＝三科都跑） | 试水时先选一科 |
| `chapters_per_run` | 这次照顾几个章节 | 预设 3 |
| `questions_per_chapter` | 每章出几题 | 预设 4，试水可以填 2 |

- 它会**自动挑题目最少的章节**优先，所以每周轮到的章节不一样
- 放了考纲，出题依官方考点；没放就只依章节标题（质量差很多）
- ⚠️ **AI 写的理科题可能科学性出错**，报告开头就会写明。合并前逐题核对，有疑虑的直接在 PR 里删掉那一题

### 3. ⚠️ 还差最后一步（目前要手动）

上面两条流水线的产物都停在 `papers/pending_approval.json`。**合并 PR 之后，题目还不会自动进正式题库**，需要把审核通过的题目搬进 `papers/<科目>_question_bank.json` 对应章节的 `mcqs` 阵列里。

这一步我还没自动化。等你第一批题跑通了跟我说，我把「打勾就上架」接起来。

---

## 二、日常：处理学生申诉

```
学生在网站上提交问题
  ↓ Formspree 寄一封信到你信箱
信里有一段「开发者代码」，形如 UECFB:xxxxx
  ↓ 打开 https://science-subjects-question.vercel.app/dev/ → 申诉处理
贴上那段代码 → 填处理说明 → 一键发布
  ↓ 写进 data/resolved_issues.json 并自动部署
学生下次开站，通知小精灵会弹出「已解决【…】，要查看吗？」
```

- 一键发布需要 Vercel 里设好 `GITHUB_TOKEN`（见第四节），没设的话接口会明确告诉你
- 发布错了可以在同一个面板**撤回**

---

## 三、日常：手动改题库

题库档案：`papers/biology_question_bank.json`、`chemistry_...`、`physics_...`

结构长这样：

```json
{
  "sections": [
    {
      "id": "chap1",
      "title": "第1章：生物是由什么组成的",
      "mcqs": [
        {
          "q": "题干文字",
          "options": ["A. 选项一", "B. 选项二", "C. 选项三", "D. 选项四"],
          "answer": 0,
          "explanation": "考点解析",
          "image": "./images/biology/xxx.jpg"
        }
      ],
      "subjectives": [
        { "question": "简答题题干", "answer": "参考答案与得分点" }
      ]
    }
  ]
}
```

要点：

- `answer` 是**下标**：`0`=A、`1`=B、`2`=C、`3`=D
- `options` 必须**恰好 4 个**，前缀 `A. ` `B. ` `C. ` `D. ` 不能少
- `image` 是选填。图片放 `images/<科目>/`，路径写 `./images/<科目>/档名.jpg`
- 改完 push 就会触发巡检（见下一节），格式错了会被抓出来
- **改 JSON 前先确认括号逗号没打错**——整个档案坏掉的话该科会变空白，巡检会报「JSON 语法损坏」

---

## 四、设定：环境变数（两个地方，别放错）

这是最容易搞错的一件事。**两套系统，互相看不到对方的变数。**

### Vercel（网站用）

`Vercel → 你的专案 → Settings → Environment Variables`，勾 **Production**，加完要到 `Deployments → ⋯ → Redeploy` 才生效。

| 变数 | 必填 | 用途 |
|---|---|---|
| `DEV_USERNAME` | ✅ | 开发者工作台的登录账号 |
| `DEV_PASSWORD` | ✅ | 登录密码（建议 16 位以上随机） |
| `DEV_SESSION_SECRET` | ✅ | **至少 16 个字符**的随机字串，用来签登录凭证。不用记、不用输入 |
| `GITHUB_TOKEN` | 选填 | 申诉处理的一键发布要用。fine-grained token，只授权这个仓库的 Contents: Read and write |
| `GITHUB_REPO` | 选填 | 预设 `K316-M/Science_Subjects_Question` |
| `GITHUB_BRANCH` | 选填 | 预设 `main` |

> 三个 `DEV_` 只要缺一个、或密钥不足 16 字符，登录页就会显示「尚未启用」并**列出到底缺哪一项**。照着补就行。

### GitHub（自动化用）

`GitHub → 仓库 → Settings → Secrets and variables → Actions`

| 变数 | 必填 | 用途 |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | 拍题录入与依考纲出题都要用。没设的话脚本会直接跳过，不会报错 |
| `GEMINI_MODEL` | 选填 | **通常不用填**。脚本会自己问 Google 有哪些模型可用再挑一个；若被回「这个模型对新用户已关闭」，会自动读取 Google 建议的替代型号再试。只有想锁定特定模型时才填 |

---

## 五、设定：开发者工作台

网址：`https://science-subjects-question.vercel.app/dev/`

| 面板 | 能做什么 |
|---|---|
| 总览 | 三科题量、待审题数、各科进度图表 |
| 申诉处理 | 贴开发者代码 → 发布／撤回处理结果 |
| 题库巡检 | 即时扫出缺配图、答案异常、选项不足的题 |
| AI 录题待审 | 列出待审区的题目（合并 PR 仍要去 GitHub 做） |
| 本机调试 | 看／清 localStorage，产生测试用的小精灵通知 |

- 登录状态保存 12 小时
- 连错 5 次密码会锁 10 分钟
- **紧急撤销所有登录**：去 Vercel 改掉 `DEV_PASSWORD` 或 `DEV_SESSION_SECRET` 再 Redeploy，所有装置立刻登出

---

## 六、定期：题库体检

每周一早上 8 点（马来西亚时间）自动跑，也可以手动：

```
GitHub → Actions → 「BioQuestion Auto Pipeline & Health Check」→ Run workflow
```

- 扫**三科题库 + 待审区**
- 结果写进 `INSPECTION_REPORT.md`（每周自动更新并提交，随时可以打开看）
- **只有真的发现缺陷才会开 Issue 提醒你**，题库正常的那几周不会打扰
- 检查项目：缺配图、图片死链、选项不是 4 个、答案序号异常、简答题缺答案、题库为空或档案损坏、待审区缺解析

---

## 七、外观微调（assets/README.md 没写的部分）

### 音乐响度统一

四首背景音乐已经统一到 −20 LUFS。**以后换新歌，先跑这行再放进去**，否则换曲时会忽大忽小：

```bash
ffmpeg -i 新歌.mp3 -af loudnorm=I=-20:TP=-1.5:LRA=11 -c:a libmp3lame -b:a 128k ambient.mp3
```

（没装 ffmpeg 的话丢给我跑也行。）

### 背景的浓淡

`index.html` 里搜 `.custom-photo-layer`：

- `opacity` → 背景整体浓度
- 底下那行 `background: linear-gradient(...)` → 盖在背景上的提亮遮罩，调淡它背景就更明显

### 背景动画的开关

每张 `assets/visual/<科目>/background.svg` 最底下有一段：

```css
@media (min-width: 900px) {
  .sway,.sway2,.sway3,.swim,.swim2,.rise { animation: none; }
}
```

**这是刻意的**：大屏幕上背景静止，换来整个介面的毛玻璃质感（两者并存会从 60 fps 掉到 18 fps）。手机面积小，所以保留动画。想让大屏也动，把这段删掉即可——代价是介面的毛玻璃要跟着拿掉。

### 轨道式学科选择器

`js/orbit-subjects.js` 最上面的设定区：

```js
const IDLE_SPEED = 4;    // 绕圈速度（度/秒），改小更慢
const SNAP_MS = 760;     // 点击后转到正上方的时间

const SUBJECTS = [
  { key:'biology', name:'生物', en:'Biology', accent:'#059669',
    deco:'dna', glyph:'leaf', enabled:true, note:'…' },
  …
];
```

- **加一科**：数组里加一行，角度自动重新均分，不用改其他代码
- **开放数学科**：把 `math` 那行的 `enabled` 改成 `true`（前提是 `papers/math_question_bank.json` 要先有章节框架）
- **换配色**：改 `accent`，球的边框、涟漪、进度弧、按钮全部跟着变

---

## 八、部署与排错

### 部署

**push 到 `main` → Vercel 自动部署**，通常十几秒到一分钟。没有其他步骤。

确认上线了没（把档名换成你改的那个）：

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://science-subjects-question.vercel.app/js/orbit-subjects.js
```

刚部署完偶尔会有几十秒的传播时间差，某个档案回 404 但别的正常，**等一下再试**。

### 出问题想退回

Vercel → Deployments → 找到上一个好的版本 → `⋯` → **Promote to Production**。这不会动你的 git 记录，是最快的止血方式。

### 改了却看不到变化

1. 硬刷新：`Ctrl+Shift+R`（Mac `Cmd+Shift+R`）
2. 还是旧的 → 手机上把网站从主屏幕删掉重加（Service Worker 会缓存）
3. 确认 Vercel 那次部署是**成功**的（Deployments 页面看状态）

### 本地预览（推送前先看一眼）

```bash
cd /path/to/Science_Subjects_Question
python3 -m http.server 8080
# 浏览器开 http://localhost:8080
```

⚠️ 这样开的话 `/api/` 接口不会动（开发者工作台登不进去），但学生网站的所有功能都能测。

### 流水线跑完了，却没有开 PR

「创建待审核 Pull Request」那步显示 ⊘（跳过）＋整个 job 只花几秒 ＝ **一题都没产出**。
点进「依考纲生成原创题并自动检查」那一步看日志，最后会列出每个章节失败的原因，例如：

```
本次没有产出可用的新题。原因如下：
  [⚠️ 生成失败] 化学 · 第一章：水和氢 —— HTTP 404：models/xxx is not found
```

常见原因：API 金钥无效或没启用 Gemini API、当月额度用完、该科还没有章节框架。

### 网址旁的红色三角形

如果 Google 误判为可疑网站：

1. 到 <https://safebrowsing.google.com/safebrowsing/report_error/> 申诉
2. Google Search Console 加入这个网址 → 安全性问题 → 要求审查
3. 根治办法是换成自己的网域（脱离 `vercel.app` 的共享名声）

---

## 九、安全

| 情况 | 怎么做 |
|---|---|
| 想换登录密码 | Vercel 改 `DEV_PASSWORD` → Redeploy（所有旧登录立刻失效） |
| 怀疑 GitHub 令牌外泄 | GitHub → Settings → Developer settings → Tokens → **Revoke**，重新产一个填回 Vercel |
| 想让所有装置登出 | 改 `DEV_SESSION_SECRET` → Redeploy |

**这个仓库目前是私有的**（你已经改过来了），所以：

- 试卷照片、题目、答案不会被外人看到，版权压力小很多
- 但**网站本身仍然是公开的** —— 任何人都能打开 `science-subjects-question.vercel.app`
  看到题目。私有的只是原始码与素材档案
- 任何密钥、令牌、密码**只能放在 Vercel／GitHub 的设定页**，绝不能写进档案
  （就算仓库私有也一样：档案会被部署到公开网站上）
- Vercel 和 GitHub 两边都建议开两步验证

---

## 附录 A：浏览器里存了什么（测试／重置用）

全部存在学生自己的浏览器里，服务器看不到。开发者工具 → Console 贴指令即可。

| 键 | 存什么 |
|---|---|
| `UEC_PROGRESS_v1` | 做题记录、错题本 |
| `UEC_NOTES_v1` | 手写笔记 |
| `UEC_FEEDBACK_v1` | 提交过的申诉 |
| `UEC_LAST_VISIT_v1` | 上次读到哪（继续上次的卡片） |
| `UEC_SCENE_MUSIC_v1` | 音乐开关状态 |
| `UEC_BIO_HL_STORE_OFFICIAL_19` | 简答题的划重点 |

```js
localStorage.removeItem('UEC_PROGRESS_v1');   // 只清做题记录
localStorage.clear();                          // 全部清空，回到新用户状态
```

工作台的「本机调试」面板也能点一点做到同样的事。

## 附录 B：档案地图

```
index.html              学生网站（单页，所有视图都在里面）
css/features.css        导航、笔记、题目档、申诉、小精灵
css/orbit.css           轨道式学科选择器
js/orbit-subjects.js    轨道选择器逻辑（加科目、改转速在这）
js/scene-assets.js      背景与音乐的装载器（路径规则在这）
js/notes.js             笔记画布
js/archive.js           题目档与 PDF 下载
js/feedback.js          申诉与通知小精灵

papers/*.json           三科正式题库
papers/pending_approval.json   待审区（AI 产物先进这里）
images/<科目>/          题目配图
drafts/<科目>/          你拍的照片丢这里
syllabus/               官方考纲
assets/visual|audio/    背景图与音乐

api/                    Vercel 无伺服器接口（登录、会话、一键发布）
dev/                    开发者工作台（独立的深色网站）
scripts/                录题、出题、巡检三支 Python 脚本
.github/workflows/      三条自动化流水线
data/resolved_issues.json      申诉处理结果（由工作台写入）
```
