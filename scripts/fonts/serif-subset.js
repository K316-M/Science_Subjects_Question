/* 标题宋体（Noto Serif SC）只下载真的会用到的字。
 *
 * 整套思源宋体切片有 600KB，手机慢速 4G 上会把首屏拖到 9 秒；
 * 改用 Google Fonts 的 text= 子集，只要几十 KB。
 * 代价是：宋体标题里出现不在子集里的字，那个字会退回系统字体。
 * 所以改了标题、章节名、导览标题之後，要重跑这支：
 *
 *   node scripts/fonts/serif-subset.js          # 重算子集，写回 index.html
 *   node scripts/fonts/serif-subset.js --check  # 只检查，有缺字就 exit 1
 *
 * 收字来源：
 *   1. 浏览器实际走过首页、各科、笔记、题目档、申诉页，所有用宋体显示的文字
 *   2. 题库的章节名（章节列、题目档、续读卡都用宋体）
 *   3. 执行时才产生的：导览标题、同步标题、整章测验（标题与成绩那段）、统考气泡的全部科目
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('../ui-check/node_modules/playwright-core');
const { ROOT, serve, findChrome } = require('../ui-check/lib');

const INDEX = path.join(ROOT, 'index.html');
const LINK_RE = /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Noto\+Serif\+SC:wght@(\d+)&text=([^"&]*)&display=swap"[^>]*>/g;
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function collect() {
  const w600 = new Set(), w800 = new Set();
  const add = (set, text) => { for (const ch of text) if (ch.trim()) set.add(ch); };

  const { server, url } = await serve();
  const browser = await chromium.launch({ executablePath: findChrome() });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('UEC_TOUR_v1', JSON.stringify({ home: 1, study: 1, test: 1, notes: 1, archive: 1, feedback: 1 })));
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(1000);

  // 整页走一遍（隐藏的元素也算）：字体是宋体的元素，收它自己的文字节点；按字重分到 600 / 800 两份
  const grab = async () => {
    const got = await page.evaluate(() => {
      const out = { w600: '', w800: '' };
      document.querySelectorAll('body *').forEach(elm => {
        const cs = getComputedStyle(elm);
        if (!/^"?Noto Serif SC/.test(cs.fontFamily)) return;
        const own = [...elm.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
        if (!own.trim()) return;
        if (Number(cs.fontWeight) >= 700) out.w800 += own; else out.w600 += own;
      });
      return out;
    });
    add(w600, got.w600); add(w800, got.w800);
  };

  await grab();
  for (const subject of ['biology', 'chemistry', 'physics']) {
    await page.evaluate(s => openSubject(s, 0), subject);
    await page.waitForTimeout(1500);
    await grab();
  }
  for (const open of ['openNotesView', 'openArchiveView', 'openFeedbackView', 'navigateHome']) {
    await page.evaluate(fn => window[fn](), open);
    await page.waitForTimeout(800);
    await grab();
  }
  await browser.close();
  server.close();

  // 题库章节名
  for (const f of fs.readdirSync(path.join(ROOT, 'papers')).filter(f => f.endsWith('_question_bank.json'))) {
    const bank = JSON.parse(read('papers/' + f));
    (bank.sections || []).forEach(s => add(w800, s.title || ''));
  }
  // 统考气泡（.exam-subject 800）随日期换成下一场的科目，今天只看得到一科：全部科目都收
  for (const m of read('js/exam-timetable.js').matchAll(/subject:\s*'([^']*)'/g)) add(w800, m[1]);
  // 导览标题（.tour-title 800）、同步标题（.sync-title 800）
  for (const m of read('js/onboarding.js').matchAll(/title:\s*'([^']*)'/g)) add(w800, m[1]);
  for (const m of read('js/sync-ui.js').matchAll(/'sync-title',\s*'([^']*)'/g)) add(w800, m[1]);
  // 整章测验：标题 700、成绩那段 400，文字写在 chapter-test.js 里；整支档的中文都收进两份，宁多勿缺
  const testText = (read('js/chapter-test.js').match(/[　-鿿＀-￯]/g) || []).join('');
  add(w600, testText); add(w800, testText);
  // 数字与常用标点，成绩、章号会用到
  add(w600, '0123456789%/：，。！？（）'); add(w800, '0123456789%/：，。！？（）');

  return { 600: [...w600].sort().join(''), 800: [...w800].sort().join('') };
}

function current() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const out = {};
  for (const m of html.matchAll(LINK_RE)) out[m[1]] = decodeURIComponent(m[2]);
  return out;
}

(async () => {
  const want = await collect();
  if (process.argv.includes('--check')) {
    const have = current();
    let missing = 0;
    for (const w of ['600', '800']) {
      const gap = [...want[w]].filter(ch => !(have[w] || '').includes(ch));
      if (gap.length) { missing += gap.length; console.log(`宋体 ${w} 缺 ${gap.length} 个字：${gap.join('')}`); }
    }
    if (missing) { console.log('跑 node scripts/fonts/serif-subset.js 更新'); process.exit(1); }
    console.log(`宋体子集齐全（600：${want[600].length} 字，800：${want[800].length} 字）`);
    process.exit(0);
  }

  // media="print" 让字体 CSS 不挡首屏（手机上快 0.3 秒左右），载完再套用到画面
  const links = ['600', '800'].map(w =>
    `<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@${w}&text=${encodeURIComponent(want[w])}&display=swap" rel="stylesheet" media="print" onload="this.media='all'">`
  ).join('\n  ');
  // 标记之间整段换掉
  const html = fs.readFileSync(INDEX, 'utf8');
  const BLOCK = /(<!-- serif-subset:start[^>]*-->\n)[\s\S]*?(\s*<!-- serif-subset:end -->)/;
  if (!BLOCK.test(html)) throw new Error('index.html 里找不到 serif-subset 标记');
  fs.writeFileSync(INDEX, html.replace(BLOCK, `$1  ${links}$2`));
  console.log(`已写回 index.html：600 ${want[600].length} 字，800 ${want[800].length} 字`);
  process.exit(0);
})();
