# 题目档 PDF 用的两支程式

- `html2canvas.min.js`：html2canvas 1.4.1，来源 https://github.com/niklasvh/html2canvas/releases/tag/v1.4.1 ，MIT 授权（见 `LICENSE-html2canvas`）
- `jspdf.umd.min.js`：jsPDF 2.5.1，来源 https://github.com/parallax/jsPDF 的 `v2.5.1` 标签里的 `dist/`，MIT 授权（见 `LICENSE-jspdf`）

以前从 cdnjs 载入，没网时就下载不了 PDF；放在网站自己的档案里，Service Worker 会在第一次下载 PDF 时存起来，之後没网也能用。
由 `js/archive.js` 的 `loadPdfLibs` 在学生第一次按「下载 PDF」时才载入。升级：换掉同名档案，版本号写在这里。
