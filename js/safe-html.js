/* 题库内容放进网页前的过滤
 *
 * 学生站把题干、解析、参考答案、配图当 HTML 显示（题库里有 <br>、<strong>、划线用的 <span class>、SVG 配图），
 * 但这些内容的源头是 AI 录题／出题：录进来的档案若藏了针对 AI 的指令，AI 就可能吐出 <img onerror=…>，
 * 一键采纳後全站同学打开那一章就会执行，读得到浏览器里的同步码。所以一律先过滤再显示。
 *
 * 做法：DOMParser 解析（解析出来的文件不执行程式、不载图），只留下面白名单里的标签与属性；
 * 其他标签拆掉、留下里面的文字，<script>、<style> 这类连内容一起删。
 * 🔴 白名单要和 scripts/qa.py、dev/dev.js 的 SAFE_TAGS 一起改：那两边的检查只标出这里会删掉的东西。
 */
const SAFE_HTML_TAGS = ['b', 'strong', 'i', 'em', 'u', 'sub', 'sup', 'br', 'span', 'p', 'div', 'small',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th'];
const SAFE_SVG_TAGS = ['svg', 'g', 'path', 'line', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'text', 'tspan'];
// SVG 只留画图用的属性；HTML 标签只留 class（划线的 hl-mark-*），不留 style、href、on…
const SAFE_SVG_ATTRS = ['viewbox', 'width', 'height', 'xmlns', 'style', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy',
  'r', 'rx', 'ry', 'd', 'points', 'dx', 'dy', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-weight', 'font-family',
  'text-anchor', 'dominant-baseline', 'writing-mode', 'transform'];
const SAFE_DROP_WITH_TEXT = ['script', 'style', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'noscript', 'noembed', 'xmp', 'textarea', 'select', 'title', 'foreignobject', 'math'];

const safeHtmlSets = {
  html: new Set(SAFE_HTML_TAGS),
  svg: new Set(SAFE_SVG_TAGS),
  svgAttrs: new Set(SAFE_SVG_ATTRS),
  drop: new Set(SAFE_DROP_WITH_TEXT),
};
const SAFE_SVG_NS = 'http://www.w3.org/2000/svg';
const SAFE_CLASS = /^[\w\s-]*$/;
const UNSAFE_STYLE = /url\s*\(|expression|javascript|@import|\\/i;
const safeHtmlCache = new Map();

function safeHtmlClean(parent) {
  Array.from(parent.childNodes).forEach(node => {
    if (node.nodeType === 3) return;                                    // 文字
    if (node.nodeType !== 1) { parent.removeChild(node); return; }       // 注解之类
    const name = node.localName.toLowerCase();
    const inSvg = node.namespaceURI === SAFE_SVG_NS;
    if (safeHtmlSets.drop.has(name)) { parent.removeChild(node); return; }
    if (!(inSvg ? safeHtmlSets.svg : safeHtmlSets.html).has(name)) {
      safeHtmlClean(node);                                              // 不认得的标签：拆掉，留下里面（已过滤）的内容
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
      return;
    }
    Array.from(node.attributes).forEach(attr => {
      const attrName = attr.name.toLowerCase();
      const keep = inSvg
        ? safeHtmlSets.svgAttrs.has(attrName) && !(attrName === 'style' && UNSAFE_STYLE.test(attr.value))
        : attrName === 'class' && SAFE_CLASS.test(attr.value);
      if (!keep) node.removeAttribute(attr.name);
    });
    safeHtmlClean(node);
  });
}

// 回传可以放进 innerHTML 的字串；题库现有的内容过滤前後逐字相同
function safeHtml(html) {
  const src = String(html == null ? '' : html);
  if (src.indexOf('<') < 0) return src;                                 // 没有「<」就不会变出标签
  const hit = safeHtmlCache.get(src);
  if (hit !== undefined) return hit;
  const body = new DOMParser().parseFromString('<!doctype html><body>' + src, 'text/html').body;
  safeHtmlClean(body);
  const out = body.innerHTML;
  if (safeHtmlCache.size > 500) safeHtmlCache.clear();
  safeHtmlCache.set(src, out);
  return out;
}

// 配图路径只收题库自己的图片档（images/ 底下）；拼进 src、onclick 之前先过这一关
function safeImagePath(path) {
  const p = String(path == null ? '' : path);
  return /^(\.?\/)?images\/[A-Za-z0-9_./-]+$/.test(p) && p.indexOf('..') < 0 ? p : '';
}
