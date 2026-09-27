# KaTeX 0.18.9（数学公式排版）

来源：https://github.com/KaTeX/KaTeX/releases/tag/v0.18.9 的 `katex.tar.gz`，MIT 授权（见 LICENSE）。
只留网站用到的：`katex.min.js`、`katex-swap.min.css`（字型载入前先用系统字，不会整段空白）、
`contrib/auto-render.min.js`、`fonts/*.woff2`（CSS 里另列的 .woff/.ttf 是旧浏览器备用，现代浏览器不会去抓）。

由 `js/math-render.js` 在画面上第一次出现 `$…$` 时才载入。升级：下载新版 `katex.tar.gz`，照上面换掉同名档案。
