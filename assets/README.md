# 自定义视觉 / 听觉素材

网站默认使用代码生成的背景色块与合成环境音乐（零外部文件、零版权风险）。
如果你想换成自己准备的图片或音乐，把文件放进对应目录，**文件名必须完全匹配下面的命名**，
网站会在打开对应科目时自动侦测并优先使用你放的文件；侦测不到时自动回退到内置设计，不会出错或留白。

## 视觉：`assets/visual/<科目>/background.*`

- 目录：`assets/visual/biology/`、`assets/visual/chemistry/`、`assets/visual/physics/`
- 文件名固定为 `background`，支持以下任一格式（按此顺序侦测）：`.jpg` / `.jpeg` / `.png` / `.webp`
- 建议：横向构图、1600×900 以上、文件大小控制在 1–2MB 内（手机加载更快）
- 效果：图片会以低透明度（约 50%）铺满整个做题页背景，上面叠加一层浅绿色渐变遮罩以保证文字可读性，所以选偏亮、对比不要太强烈的图更好看

例：把一张生物相关的图放到 `assets/visual/biology/background.jpg` 即可生效，无需改任何代码。

## 听觉：`assets/audio/<科目>/ambient.*`

- 目录：`assets/audio/biology/`、`assets/audio/chemistry/`、`assets/audio/physics/`
- 文件名固定为 `ambient`，支持：`.mp3` / `.ogg` / `.m4a`
- 会自动循环播放，音量已调低（约 35%），无需自行淡入淡出处理
- 请使用免费商用或已获授权的纯音乐（如 Pixabay Music、YouTube Audio Library、Free Music Archive 上明确标注可商用的曲目），文件大小建议 1–3MB（太大手机加载会慢）

## 找素材的地方（免费、可商用、无需署名）

- 图片／插画：[unDraw](https://undraw.co)、[Storyset](https://storyset.com)、[Freepik](https://www.freepik.com)（部分需署名，注意查看授权条款）
- 音乐：[Pixabay Music](https://pixabay.com/music/)、[YouTube Audio Library](https://www.youtube.com/audiolibrary)、[Free Music Archive](https://freemusicarchive.org)

放好文件、推送到 `main` 后，Vercel 会在几秒内自动更新，直接刷新网页即可看到效果。
