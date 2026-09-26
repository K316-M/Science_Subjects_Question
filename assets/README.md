# 自定义背景与音乐：自己动手指南

只要记住一条规则：

> **文件夹的名字 = 场景的名字。**
> 把图片放进 `assets/visual/<场景名>/background.jpg`，
> 把音乐放进 `assets/audio/<场景名>/ambient.mp3`，网站就会自动用上，**不需要改任何代码**。

侦测不到文件时会自动退回 `default/`，再没有就用内置的生成式设计，页面不会出错也不会留白。

---

## 一、现在已经存在的场景

| 场景名 | 用在哪里 | 放图片的位置 | 放音乐的位置 |
|---|---|---|---|
| `biology` | 生物做题页 | `assets/visual/biology/background.jpg` | `assets/audio/biology/ambient.mp3` |
| `chemistry` | 化学做题页 | `assets/visual/chemistry/background.jpg` | `assets/audio/chemistry/ambient.mp3` |
| `physics` | 物理做题页 | `assets/visual/physics/background.jpg` | `assets/audio/physics/ambient.mp3` |
| `default` | **所有找不到自己素材的场景** | `assets/visual/default/background.jpg` | `assets/audio/default/ambient.mp3` |

想让全站有个统一的底图／底乐，只放 `default/` 那一份就够了。

**换素材的步骤**：把文件丢进对应文件夹 → 推送到 `main` → 等 Vercel 几秒钟 → 刷新网页。

---

## 二、以后新增页面，怎么接上自己的背景和音乐

假设你要做一个新页面叫「公式表」，想给它专属的背景和音乐。

### 第 1 步：建文件夹，放素材

```
assets/visual/formula/background.jpg
assets/audio/formula/ambient.mp3
```

`formula` 这个名字随你取，**它就是场景名**。

### 第 2 步：新页面里加两样东西

`<body>` 上写 `data-scene="formula"`，页面底部引入 `/js/scene-assets.js`。就这样，没有第三样。

### 第 3 步：推送，完成。

### 可以直接复制的新页面模板

```html
<!DOCTYPE html>
<html lang="zh-MY">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>公式表 · 独中理科</title>
  <link rel="stylesheet" href="/css/features.css">
</head>
<body data-scene="formula">

  <main class="container">
    <h1>公式表</h1>
    <p>页面内容写在这里。</p>
  </main>

  <script src="/js/scene-assets.js"></script>
</body>
</html>
```

> **连 `data-scene` 都懒得写？** 不写也行——装载器会拿网页文件名当场景名。
> `formula.html` → 自动找 `assets/visual/formula/`。
> 也就是说：**新页面叫什么，就建一个同名文件夹，完事。**

---

## 三、想微调效果：在 `<body>` 上加属性即可

| 属性 | 作用 | 默认值 | 例子 |
|---|---|---|---|
| `data-scene` | 指定场景名；写 `off` 表示这页不要自动装配 | 网页文件名 | `data-scene="formula"` |
| `data-scene-opacity` | 背景图浓度，0～1，越小越淡 | `0.5` | `data-scene-opacity="0.3"` |
| `data-scene-veil` | 盖在图上的遮罩（保证文字看得清），任何 CSS 背景值 | 浅绿渐变 | `data-scene-veil="rgba(0,0,0,.45)"`（深色页面用） |
| `data-scene-volume` | 音乐音量，0～1 | `0.35` | `data-scene-volume="0.2"` |
| `data-scene-music` | `button` 显示开关钮／`auto` 自动播放不显示钮／`off` 完全不要音乐 | `button` | `data-scene-music="off"` |

音乐开关钮默认浮在右下角。想把它放进你自己的导航栏里，就在那个位置放一个空元素：

```html
<span data-scene-music-slot></span>
```

按钮会自动长在那里面，样式也会跟着变成普通按钮（不再浮动）。

音乐的开关状态会**记在浏览器里、跨页面通用**：学生在主页关掉音乐，进新页面也还是关着的。

### 一个页面里要换好几种背景？

例如按章节切换。在你自己的代码里调用：

```js
SceneAssets.use('formula-chapter3');   // 立刻切到 assets/visual/formula-chapter3/
```

对应的文件夹存在就换，不存在就自动退回 `default/`。

---

## 四、素材规格建议

**图片**
- 文件名固定叫 `background`，支持 `.jpg` `.jpeg` `.png` `.webp` `.avif`（按这个顺序找，找到就用）
- 横向构图、1600×900 以上、**控制在 1–2MB 以内**（手机流量友好）
- 会被盖上一层遮罩再垫在文字底下，所以**选偏亮、对比不要太强、中间不要有重点内容**的图最好看

**音乐**
- 文件名叫 `ambient`（叫 `background` 也认得，两边用同一个词比较好记），支持 `.mp3` `.ogg` `.m4a` `.wav`
- 会自动循环播放、音量已调低，你不用自己做淡入淡出
- **建议先过一遍处理脚本**：把原档放进 `source/audio/<场景名>/ambient.mp3`（不会部署），跑 `python3 scripts/audio/build.py`，
  它会剪掉头尾静音（不然每轮循环都会安静好几秒）、把结尾接回开头做成无缝循环、统一音量、压小档案，再放进这里
- 还没决定要不要用的候选曲放 `source/audio/candidates/`，不会上网站
- 建议 1–3MB；**选没有明显旋律起伏的纯音乐**（lo-fi、环境音、钢琴铺底），做题时才不会分心
- ⚠️ 浏览器规定「用户没点过页面就不许出声」，所以音乐一定是在第一次点击之后才响，这是正常现象，不是坏了

**免费、可商用的素材来源**
- 图片／插画：[unDraw](https://undraw.co)、[Storyset](https://storyset.com)、[Unsplash](https://unsplash.com)、[Pexels](https://www.pexels.com)
- 音乐：[Pixabay Music](https://pixabay.com/music/)、[YouTube Audio Library](https://www.youtube.com/audiolibrary)、[Free Music Archive](https://freemusicarchive.org)

> 仓库目前是私有的，但**素材档案会被部署到公开网站上**（任何人都能直接开启图片与音乐的网址），
> 所以还是请只放自己拍的、或授权允许公开转发的素材。

---

## 五、放了却没生效？照这个顺序查

1. **文件名对不对**——图片叫 `background.xxx`，音乐叫 `ambient.xxx` 或 `background.xxx`；不能叫 `Background.jpg`、`background (1).jpg`、`bg.jpg`
2. **大小写**——服务器区分大小写，`Biology/` ≠ `biology/`
3. **文件夹名和 `data-scene` 是否一致**——差一个字母就找不到
4. **推送了吗**——文件要 commit 并 push 到 `main`，Vercel 才看得到
5. **浏览器缓存**——按 `Ctrl+Shift+R`（Mac 是 `Cmd+Shift+R`）强制刷新
6. 还是不行 → 按 `F12` 打开开发者工具 → Network 分页 → 刷新页面 → 搜 `background`，看请求回的是 200（找到了）还是 404（路径错了），404 里显示的那个网址就是网站**期待**的位置，照着它改文件路径即可

音乐没响，但图有出来 → 多半是还没点过页面（见上面第四节的浏览器规定），点一下任意位置再试。

> **顺带一提**：打开开发者工具时，你会看到几条 `background.jpg 404`、`ambient.mp3 404` 的红字。
> 那是网站在「问这个文件你放了没有」，**没放就是 404，属于正常现象**，不影响任何功能。
> 你放的格式越靠前（图片用 `.jpg`、音乐用 `.mp3`），红字就越少。
