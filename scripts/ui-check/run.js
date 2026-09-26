#!/usr/bin/env node
/* 一键 UI 检查
 *   第一次：cd scripts/ui-check && npm install
 *   之後：  node scripts/ui-check/run.js
 *
 * 每一项都来自评审或 bug 实际抓到过的问题——不是泛泛的测试，是「这些坏过，别再坏」。
 * 全部通过才会回传 0；截图放在 scripts/ui-check/out/，改版後至少看一眼。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { ROOT, OUT, serve, findChrome, contrast } = require('./lib');

const DAY = 864e5;
const results = [];
const check = (group, name, pass, detail) => results.push({ group, name, pass: Boolean(pass), detail: detail === undefined ? '' : detail });
const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'papers', 'biology_question_bank.json'), 'utf8'));
const CH1 = bank.sections[0];

let URL_, browser;

async function open({ width = 390, height = 844, mobile = false, reducedMotion, seed, clock = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile, reducedMotion });
  // sessionStorage 标记：只在第一次载入时塞资料，重新整理不会把测试中的状态洗掉
  await ctx.addInitScript((seed) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    // explain 也要算看过：答完第一题 1.5 秒後它会自己跳出来，淡入到一半被对比度取样到就误报
    localStorage.setItem('UEC_TOUR_v1', JSON.stringify({ home: 1, study: 1, test: 1, notes: 1, archive: 1, feedback: 1, explain: 1 }));
    if (seed) Object.entries(seed).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
  }, seed || null);
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('request', r => requests.push(new URL(r.url()).pathname));
  if (clock) await page.clock.install();
  await page.goto(URL_);
  await page.waitForTimeout(1000);
  return { ctx, page, errors, requests };
}
async function enter(page, orbitIdx = 0) {
  // 轨道球一直在转，Playwright 等不到「静止」，所以直接在页面里点
  await page.evaluate(i => document.querySelectorAll('.orbit-node')[i].click(), orbitIdx);
  await page.waitForTimeout(450);
  await page.evaluate(() => document.querySelector('.panel-enter').click());
  await page.waitForTimeout(1100);
}
async function section(group, fn) {
  try { await fn(); }
  catch (e) { check(group, '执行时出错', false, String(e.message || e).split('\n')[0].slice(0, 160)); }
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

/* ================================================================ */

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const R = [];   // 对比度样本

  await section('载入', async () => {
    const { ctx, page, errors, requests } = await open();
    check('载入', '没有 JS 错误', errors.length === 0, errors[0]);
    check('载入', '不会每次载入就打同步 API', !requests.some(u => u.startsWith('/api/sync')));
    check('载入', '不会去要 /favicon.ico', !requests.includes('/favicon.ico'));
    await contrast(page, 'mobile 首页', null, R);
    await shot(page, 'mobile-home');
    await ctx.close();
  });

  await section('效能', async () => {
    // 首页的光团一直在飘；盖在上面的全屏图层只要带混合模式，整个画面就得每帧重算（1920 曾经只有 31 fps）
    const { ctx, page } = await open({ width: 1920, height: 1080 });
    const blended = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return cs.mixBlendMode !== 'normal' && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width * r.height > innerWidth * innerHeight / 2;
    }).map(el => `.${el.className}`));
    check('效能', '桌面首页：没有全屏图层用混合模式', blended.length === 0, blended.join(', '));
    await ctx.close();
  });

  await section('字阶与间距', async () => {
    // 字级、行高、间距各收成一套阶梯（docs/DESIGN.md 第七轮）。新样式用了阶梯外的值，这里会指名道姓
    const FS = [11, 12, 13, 14, 16, 19, 23, 28, 32, 40, 56];
    const LH = ['1', '1.2', '1.4', '1.6', '1.75'];
    const SP = [1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 48, 56];
    const files = ['index.html', 'css/features.css', 'css/orbit.css', 'css/night.css',
      ...fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)];
    const bad = { 字级: [], 行高: [], 间距: [] };
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const m of src.matchAll(/font-size\s*:\s*([0-9.]+)px/g)) if (!FS.includes(Number(m[1]))) bad.字级.push(`${rel} ${m[1]}px`);
      for (const m of src.matchAll(/line-height\s*:\s*([0-9.]+)\s*[;}\n]/g)) if (!LH.includes(m[1])) bad.行高.push(`${rel} ${m[1]}`);
      for (const m of src.matchAll(/(?:margin|padding|gap|row-gap|column-gap)(?:-top|-bottom|-left|-right)?\s*:\s*([^;}\n]+)/g)) {
        if (/calc\(|var\(|clamp\(|min\(|max\(/.test(m[1])) continue;
        for (const n of m[1].matchAll(/-?([0-9.]+)px/g)) if (!SP.includes(Number(n[1]))) bad.间距.push(`${rel} ${n[0]}`);
      }
    }
    for (const [k, list] of Object.entries(bad))
      check('字阶与间距', `${k}只用阶梯上的值`, list.length === 0, `${list.length} 处：${[...new Set(list)].slice(0, 6).join('、')}`);
  });

  await section('首页轨道', async () => {
    for (const w of [320, 360, 390]) {
      const { ctx, page } = await open({ width: w, height: 800, mobile: true });
      const rows = await page.evaluate(() => new Set([...document.querySelectorAll('.util-actions .sound-toggle')].map(b => Math.round(b.getBoundingClientRect().top))).size);
      check('首页轨道', `${w}px：工具列五颗按钮排成一行`, rows === 1, `${rows} 行`);
      await page.evaluate(() => document.querySelectorAll('.orbit-node')[0].click());
      await page.waitForTimeout(900);
      // 确认面板摆在轨道的空心里；伸出去就会盖住旁边的球，那些球还要能点
      const hit = await page.evaluate(() => {
        const pr = document.querySelector('.orbit-panel').getBoundingClientRect();
        const over = a => Math.min(a.right, pr.right) > Math.max(a.left, pr.left) && Math.min(a.bottom, pr.bottom) > Math.max(a.top, pr.top);
        return [...document.querySelectorAll('.orbit-node:not(.is-selected)')]
          .filter(n => over(n.querySelector('.node-label').getBoundingClientRect()) || over(n.querySelector('.node-disc').getBoundingClientRect()))
          .map(n => n.querySelector('.node-label').textContent.trim());
      });
      check('首页轨道', `${w}px：确认面板不盖住其他科目的球与标签`, hit.length === 0, hit.join('、'));
      await ctx.close();
    }
  });

  await section('统考时间表与题库覆盖', async () => {
    const { ctx, page, errors } = await open();
    const r = await page.evaluate(() => {
      const box = document.getElementById('examNext');
      const table = window.UEC_EXAM || {};
      // 还没考完（结束时间还没到）的场次才算
      const now = new Date();
      const up = (table.papers || []).filter(p => new Date(`${p.date}T${p.end}:00`) > now)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.half === b.half ? 0 : a.half === '上午' ? -1 : 1));
      const next = up[0] && { ...up[0], subjects: up.filter(p => p.date === up[0].date && p.half === up[0].half).map(p => p.subject) };
      return {
        subject: (box.querySelector('.exam-subject') || {}).textContent,
        when: (box.querySelector('.exam-when b') || {}).textContent,
        half: (box.querySelector('.exam-when em') || {}).textContent,
        cal: !!box.querySelector('svg.exam-cal'),
        sr: (box.querySelector('.sr-only') || {}).textContent,
        subjects: (table.papers || []).map(p => p.subject),
        times: (table.papers || []).flatMap(p => [p.start, p.end]),
        next,
      };
    });
    const [, m, d] = (r.next || { date: '--' }).date.split('-');
    check('统考时间表与题库覆盖', '首页显示最靠近的一场：图标 + 科目 + 日/月 + 上下午与开始时间', r.cal && r.subject === r.next.subjects.join('·') && r.when === `${Number(d)}/${Number(m)}` && r.half.startsWith(r.next.half) && /\d{1,2}:\d{2}$/.test(r.half),
      JSON.stringify({ subject: r.subject, when: r.when, half: r.half }));
    check('统考时间表与题库覆盖', '读屏念得出完整日期', /最靠近的统考科目/.test(r.sr || '') && /\d+ 年 \d+ 月 \d+ 日/.test(r.sr || ''), (r.sr || '').trim());
    const banned = ['会计学', '商业学', '经济学', '电学原理', '电子学', '电机学', '数位逻辑', '美术赏析', '平面设计', '地理', '餐饮理论与实务', '厨艺理论与实务'];
    check('统考时间表与题库覆盖', '时间表只收理科生可报考的科目', !r.subjects.some(x => banned.includes(x)) && r.subjects.includes('美术'), r.subjects.join('、'));
    check('统考时间表与题库覆盖', '每一场都有开始与结束时间（HH:MM）', r.times.every(t => /^\d{2}:\d{2}$/.test(t)), r.times.join(' '));
    // 点开日历：列出全部场次（同一天同一时段合成一列），Esc 收起
    await page.click('#examNext .exam-toggle');
    const list = await page.evaluate(() => {
      const slots = new Set(window.UEC_EXAM.papers.map(p => p.date + p.half)).size;
      return { exp: document.querySelector('#examNext .exam-toggle').getAttribute('aria-expanded'), shown: !document.getElementById('examList').hidden,
        rows: document.querySelectorAll('#examList .exam-slot').length, slots, next: document.querySelectorAll('#examList .exam-slot.is-next').length };
    });
    check('统考时间表与题库覆盖', '点开日历：按顺序列出全部场次，标出下一场', list.exp === 'true' && list.shown && list.rows === list.slots && list.next === 1, JSON.stringify(list));
    await page.keyboard.press('Escape');
    check('统考时间表与题库覆盖', '按 Esc 收起时间表', await page.evaluate(() => document.getElementById('examList').hidden));
    // 全部考完：不该继续显示某一科
    const done = await page.evaluate(() => {
      window.UEC_EXAM.papers = window.UEC_EXAM.papers.map(p => ({ ...p, date: '2020-10-21' }));
      renderExamNext();
      // 只看首页气泡；点开的完整时间表本来就列著每一场的上午／下午
      return document.querySelector('#examNext .exam-bubble').textContent.trim();
    });
    check('统考时间表与题库覆盖', '全部考完：说考完了，不再挑一科出来', /已经考完了/.test(done) && !/上午|下午/.test(done), done);
    await enter(page);
    const cov = (await page.textContent('#bankCoverage')).trim();
    const withQ = bank.sections.filter(s => (s.mcqs || []).length + (s.subjectives || []).length > 0).length;
    const total = bank.sections.reduce((n, s) => n + (s.mcqs || []).length, 0);
    check('统考时间表与题库覆盖', '做题页写明题库覆盖了考纲几章', cov === `依考纲共 ${bank.sections.length} 章 · 目前 ${withQ} 章有题目，合计 ${total} 道选择题`, cov);
    check('统考时间表与题库覆盖', '没有 JS 错误', errors.length === 0, errors[0]);
    await ctx.close();
  });

  await section('画面导览', async () => {
    // 不预设「看过」：模拟第一次来的学生
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    await page.goto(URL_); await page.waitForTimeout(1800);
    const tipTitle = () => page.evaluate(() => { const t = document.querySelector('.tour-tip .tour-title'); return t ? t.textContent : null; });
    const next = () => page.evaluate(() => document.querySelector('.tour-tip .tour-btn.go').click());
    const first = await tipTitle();
    check('画面导览', '第一次打开：首页自动开始导览，第一步是欢迎', first === '欢迎来到独中理科', first);
    await contrast(page, 'desktop 导览', '.tour-tip', R);
    const seenTitles = [];
    for (let i = 0; i < 8 && await tipTitle(); i++) { seenTitles.push(await tipTitle()); await next(); await page.waitForTimeout(600); }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('UEC_TOUR_v1') || '{}'));
    check('画面导览', '走完五步就结束，记下首页看过', seenTitles.length === 5 && saved.home === 1, `${seenTitles.length} 步：${seenTitles.join(' → ')}`);
    await page.reload(); await page.waitForTimeout(1800);
    check('画面导览', '看过之後重新整理，不再自动出现', (await tipTitle()) === null);

    await enter(page); await page.waitForTimeout(1800);
    const study = await page.evaluate(() => {
      const t = document.querySelector('.tour-tip .tour-title'), s = document.querySelector('.tour-spot');
      const rail = document.getElementById('chapterRail').getBoundingClientRect(), r = s && s.getBoundingClientRect();
      return { title: t && t.textContent, around: !!r && r.left <= rail.left && r.right >= rail.right - 1 && r.top <= rail.top && r.bottom >= rail.bottom };
    });
    check('画面导览', '第一次进做题页：换成做题页的导览，亮框圈住章节卡', study.title === '章节' && study.around, JSON.stringify(study));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const esc = await page.evaluate(() => ({ open: !!document.querySelector('.tour-tip'), seen: JSON.parse(localStorage.getItem('UEC_TOUR_v1')).study }));
    check('画面导览', '按 Esc 跳过：关掉，也算看过', !esc.open && esc.seen === 1, JSON.stringify(esc));

    await page.evaluate(() => openFeedbackView()); await page.waitForTimeout(1800);
    await next(); await page.waitForTimeout(700);
    const sprite = await page.evaluate(() => ({ title: document.querySelector('.tour-tip .tour-title').textContent,
      shown: document.getElementById('spriteWrap').classList.contains('active') }));
    await next(); await page.waitForTimeout(500);
    const after = await page.evaluate(() => document.getElementById('spriteWrap').classList.contains('active'));
    check('画面导览', '申诉页介绍小精灵：它会出现；导览结束後退场', sprite.title === '这是小精灵' && sprite.shown && !after, `${JSON.stringify(sprite)}，结束後 ${after}`);
    check('画面导览', '没有 JS 错误', errors.length === 0, errors[0]);
    await ctx.close();
  });

  await section('同步链结', async () => {
    // 另一台装置打开「网址/#sync=同步码」：问一次、接上、网址列马上清掉、面板出现 QR 码
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => localStorage.setItem('UEC_TOUR_v1', JSON.stringify({ home: 1, study: 1, test: 1, notes: 1, archive: 1, feedback: 1 })));
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    const asked = []; page.on('dialog', d => { asked.push(d.message()); d.accept(); });
    await page.goto(URL_ + '#sync=ABCD-EFGH-JKLM-NPQR-STUV'); await page.waitForTimeout(2500);
    const r = await page.evaluate(() => ({ hash: location.hash, code: (JSON.parse(localStorage.getItem('UEC_SYNC_v1') || '{}')).code,
      open: document.querySelector('.sync-mask').classList.contains('is-open'), qr: !!document.querySelector('.sync-qr svg') }));
    check('同步链结', '打开链结：先问一次才接上', asked.length === 1 && r.code === 'ABCDEFGHJKLMNPQRSTUV', `问了 ${asked.length} 次，码 ${r.code}`);
    check('同步链结', '同步码马上从网址列拿掉', r.hash === '', r.hash);
    check('同步链结', '面板打开，并画出给另一台装置扫的 QR 码', r.open && r.qr, JSON.stringify(r));
    check('同步链结', '没有 JS 错误', errors.length === 0, errors[0]);
    await ctx.close();
  });

  await section('版面', async () => {
    for (const w of [320, 360, 390, 768, 1440]) {
      const { ctx, page } = await open({ width: w, height: 844 });
      await enter(page);
      await page.evaluate(() => { document.getElementById('wrongCountBadge').textContent = '12'; document.getElementById('reviewCountBadge').textContent = '8'; });
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        // 相差不到半个按钮高就算同一行：系统字体的基线会让某颗按钮低个 1px，那不是换行
        const rects = [...document.querySelectorAll('.nav-item')].map(e => e.getBoundingClientRect());
        const top0 = Math.min(...rects.map(r => r.top));
        const tops = new Set(rects.map(r => Math.round((r.top - top0) / (r.height / 2))));
        return { overflow: document.documentElement.scrollWidth - innerWidth, rows: tops.size,
          fb: document.getElementById('navFeedbackBtn').innerText.trim() };
      });
      check('版面', `${w}px 带双徽章：无横向溢出`, r.overflow === 0, `溢出 ${r.overflow}px`);
      check('版面', `${w}px：顶栏一行且「报错／申诉」有字`, r.rows === 1 && r.fb.length > 0, `${r.rows} 行，标签「${r.fb}」`);
      await ctx.close();
    }
  });

  await section('导览结束回到原位', async () => {
    // 导览每一步都会把画面捲到目标；走完（或跳过）要捲回按「引导」之前的位置，不能停在最後一步
    // 视窗矮一点：做题页只有八百多 px 高，844 的视窗几乎捲不动
    const { ctx, page, errors } = await open({ height: 560 });
    await enter(page);
    await page.evaluate(() => scrollTo(0, 250)); await page.waitForTimeout(300);
    const y0 = await page.evaluate(() => Math.round(scrollY));
    const ys = [];
    await page.evaluate(() => document.getElementById('guideBtn').click());
    for (let i = 0; i < 10 && await page.evaluate(() => !!document.querySelector('.tour-tip')); i++) {
      await page.waitForTimeout(700);
      ys.push(await page.evaluate(() => Math.round(scrollY)));
      await page.evaluate(() => document.querySelector('.tour-tip .tour-btn.go').click());
    }
    await page.waitForTimeout(1000);
    const y1 = await page.evaluate(() => Math.round(scrollY));
    check('导览结束回到原位', '走完做题页导览：捲回按「引导」之前的位置', y0 > 0 && ys.some(y => Math.abs(y - y0) > 20) && Math.abs(y1 - y0) <= 2,
      `之前 ${y0}，导览中 ${ys.join('→')}，结束後 ${y1}`);
    await page.evaluate(() => scrollTo(0, 250)); await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('guideBtn').click()); await page.waitForTimeout(700);
    const yEsc = await page.evaluate(() => Math.round(scrollY));
    await page.keyboard.press('Escape'); await page.waitForTimeout(1000);
    const y2 = await page.evaluate(() => Math.round(scrollY));
    check('导览结束回到原位', '按 Esc 跳过也捲回原位', Math.abs(yEsc - y0) > 20 && Math.abs(y2 - y0) <= 2, `之前 ${y0}，第一步 ${yEsc}，结束後 ${y2}`);
    check('导览结束回到原位', '没有 JS 错误', errors.length === 0, errors[0]);
    await ctx.close();
  });

  await section('继续上次学习', async () => {
    // 只是点进一科看过、一题都没做：回首页不该出现「继续上次学习进度」；答了一题才出现
    const { ctx, page, errors } = await open();
    await enter(page);
    await page.evaluate(() => navHome()); await page.waitForTimeout(600);
    const before = await page.evaluate(() => !!document.querySelector('#resumeCard .resume-card'));
    await enter(page);
    await page.evaluate(() => document.querySelector('#optContainer .option-btn').click()); await page.waitForTimeout(300);
    await page.evaluate(() => navHome()); await page.waitForTimeout(600);
    const after = await page.evaluate(() => !!document.querySelector('#resumeCard .resume-card'));
    check('继续上次学习', '没做过题：首页不显示', !before);
    check('继续上次学习', '答过一题：首页出现', after);
    check('继续上次学习', '没有 JS 错误', errors.length === 0, errors[0]);
    await ctx.close();
  });

  await section('答错结算', async () => {
    const { ctx, page, errors } = await open();
    await enter(page);
    const ans = CH1.mcqs[0].answer;
    const r = await page.evaluate((ans) => {
      const o = [...document.querySelectorAll('#optContainer .option-btn')];
      const wrong = o.findIndex((_, i) => i !== ans);
      o[wrong].click();
      o.forEach(x => x.click());   // 乱点：每一颗都再点一次
      const rec = JSON.parse(localStorage.getItem('UEC_REVIEW_v1') || '{}');
      return {
        wrongMarked: o.filter(x => x.classList.contains('wrong')).length,
        locked: o.every(x => x.classList.contains('locked') && x.getAttribute('aria-disabled') === 'true'),
        correctTagged: !!o[ans].querySelector('.opt-tag'),
        exp: getComputedStyle(document.getElementById('expContainer')).display,
        verdict: document.getElementById('mcqVerdict').textContent,
        lapses: Object.values(rec)[0] && Object.values(rec)[0].lapses,
      };
    }, ans);
    check('答错结算', '答错即锁定，乱点也只记一个错', r.wrongMarked === 1 && r.locked, `标错 ${r.wrongMarked} 个`);
    check('答错结算', '标出正确答案（有文字，不只靠颜色）', r.correctTagged);
    check('答错结算', '展开解析并说出正确答案', r.exp === 'block' && r.verdict.includes('正确答案是'), r.verdict);
    check('答错结算', '复习排程只记一次错', r.lapses === 1, `lapses=${r.lapses}`);
    check('答错结算', '没有 JS 错误', errors.length === 0, errors[0]);
    await page.waitForTimeout(600);
    await page.evaluate(() => scrollTo(0, 0));
    await contrast(page, 'mobile 答错後', null, R);
    await shot(page, 'mobile-answered');
    await ctx.close();
  });

  await section('错题本', async () => {
    const legacyWrong = { biology: { [bank.sections[1].id]: { 0: 'wrong' } } };   // 复习功能上线前留下的错题
    const { ctx, page, errors } = await open({ seed: { UEC_PROGRESS_v1: legacyWrong } });
    await enter(page);
    const r = await page.evaluate(({ c1, DAY }) => {
      const R = window.UECReview;
      const base = new Date(); base.setHours(10, 0, 0, 0);
      const t = base.getTime();
      const s = [];
      R.record('biology', c1, 0, false, t);             s.push(R.isWeakItem('biology', c1, 0));   // 答错 → 收进来
      R.record('biology', c1, 0, true, t + 3600e3);     s.push(R.isWeakItem('biology', c1, 0));   // 同一天答对 → 还在
      R.record('biology', c1, 0, true, t + 7200e3);     s.push(R.isWeakItem('biology', c1, 0));   // 同一天再对 → 还在
      R.record('biology', c1, 0, true, t + DAY);        s.push(R.isWeakItem('biology', c1, 0));   // 隔天答对 → 移出
      R.record('biology', c1, 0, false, t + 5 * DAY);   s.push(R.isWeakItem('biology', c1, 0));   // 掌握後又错 → 回来
      for (let k = 0; k < 3; k++) R.record('biology', c1, 1, false, t + k * DAY);                  // 连错 3 次 → 顽固
      window.updateWrongCountBadge();   // 上面绕过介面直接写纪录；真实作答时介面会做这一步
      return s;
    }, { c1: CH1.id, DAY });
    check('错题本', '答错就收进来', r[0] === true);
    check('错题本', '同一天连对两次不移出', r[1] === true && r[2] === true);
    check('错题本', '不同的两天都答对才移出', r[3] === false);
    check('错题本', '以前答对过、後来又错，会重新收回', r[4] === true);
    await page.evaluate(() => window.switchSubSection('wrong'));
    await page.waitForTimeout(500);
    const v = await page.evaluate(() => ({
      stubbornTitle: (document.querySelector('.wrong-group.is-stubborn .wrong-group-title') || {}).textContent || '',
      stubbornMeta: (document.querySelector('.wrong-group.is-stubborn .wrong-row-meta') || {}).textContent || '',
      rows: document.querySelectorAll('.wrong-row').length,
      badge: document.getElementById('wrongCountBadge').textContent,
    }));
    check('错题本', '错 3 次以上排在「顽固题」', v.stubbornTitle.includes('顽固') && v.stubbornMeta.includes('错过 3 次'), v.stubbornMeta);
    check('错题本', '旧版留下的错题也在（共 3 题：顽固 1、重新收回 1、旧版 1）', v.rows === 3 && v.badge === '3', `${v.rows} 行，徽章 ${v.badge}`);
    check('错题本', '没有 JS 错误', errors.length === 0, errors[0]);
    await contrast(page, 'mobile 错题本', null, R);
    await shot(page, 'mobile-wrong-book');
    await ctx.close();
  });

  await section('今日复习', async () => {
    const now = Date.now();
    const rec = off => ({ ease: 2.3, interval: 3, reps: 1, lapses: 0, last: now - 5 * DAY, due: now - off });
    const seed = { UEC_REVIEW_v1: { [`biology__${bank.sections[1].id}__1`]: rec(4 * DAY), [`biology__${bank.sections[2].id}__2`]: rec(60e3) } };
    const { ctx, page, errors } = await open({ seed });
    await enter(page);
    await page.evaluate(() => window.switchSubSection('review'));
    await page.waitForTimeout(400);
    const c0 = await page.evaluate(() => document.querySelector('.review-count').textContent.trim());
    await contrast(page, 'mobile 今日复习', null, R);
    await shot(page, 'mobile-review');
    await page.evaluate(() => document.querySelector('.review-head .empty-btn').click());
    await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelectorAll('#optContainer .option-btn')[0].click());
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => (document.querySelector('.verdict-next') || {}).textContent || '');
    await page.evaluate(() => document.querySelector('.verdict-next').click());
    await page.waitForTimeout(400);
    const c1 = await page.evaluate(() => document.querySelector('.review-count').textContent.trim());
    await page.evaluate(() => document.querySelector('.review-head .empty-btn').click());
    await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelectorAll('#optContainer .option-btn')[0].click());
    await page.waitForTimeout(300);
    await page.evaluate(() => window.switchSubSection('review'));
    await page.waitForTimeout(400);
    const end = await page.evaluate(() => (document.querySelector('.empty-title') || {}).textContent || '');
    check('今日复习', '显示今天的进度', c0.replace(/\s+/g, '') === '今天0/2题', c0);
    check('今日复习', '从复习进来的题，作答後有「回到今日复习」', back.includes('回到今日复习'), back);
    check('今日复习', '做一题後进度前进', c1.replace(/\s+/g, '') === '今天1/2题', c1);
    check('今日复习', '做完有收尾画面', end.includes('做完了'), end);
    check('今日复习', '没有 JS 错误', errors.length === 0, errors[0]);
    await ctx.close();
  });

  await section('键盘', async () => {
    const { ctx, page, errors } = await open({ width: 1280, height: 900 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const skip = await page.evaluate(() => ({ cls: document.activeElement.className, top: document.activeElement.getBoundingClientRect().top }));
    check('键盘', '第一下 Tab 出现「跳到主要内容」', skip.cls === 'skip-link' && skip.top >= 0);
    await enter(page);
    // 走「跳到主要内容」这条捷径：第一下 Tab 到跳转链接、Enter，之後再数
    // 直接聚焦跳转链接：Chrome 会记住「上次 Tab 到哪」，blur 之後再按 Tab 不一定从页首开始
    await page.evaluate(() => { scrollTo(0, 0); document.querySelector('.skip-link').focus(); });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    let n = 0;
    for (; n < 40; n++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement.classList.contains('option-btn'))) break;
    }
    check('键盘', '经跳转链接到第一个选项 ≤ 10 下 Tab', n + 1 <= 10, `${n + 1} 下`);
    // 章节列平常收在选单里：先点开，再用方向键
    await page.evaluate(() => document.getElementById('chapterToggle').click());
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#chapterRail [tabindex="0"]').focus());
    const ch0 = await page.evaluate(() => document.querySelector('#chapterRail [aria-selected="true"]').getAttribute('aria-label'));
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
    const ch = await page.evaluate(() => ({ now: document.querySelector('#chapterRail [aria-selected="true"]').getAttribute('aria-label'),
      focused: document.activeElement.getAttribute('aria-selected') === 'true' }));
    check('键盘', '章节列用方向键切换，焦点跟著走', ch.now !== ch0 && ch.focused);
    const stillOpen = await page.evaluate(() => !document.getElementById('chapterPanel').hidden);
    check('键盘', '用方向键换章时选单保持展开（只有真的点一下才收起）', stillOpen);
    await page.keyboard.press('Escape');
    const esc2 = await page.evaluate(() => ({ closed: document.getElementById('chapterPanel').hidden, focus: document.activeElement.id }));
    check('键盘', '按 Esc 收起章节选单，焦点回到选单按钮', esc2.closed && esc2.focus === 'chapterToggle', JSON.stringify(esc2));
    await page.evaluate(() => { window.openSubject('biology'); });
    await page.waitForTimeout(1100);
    await page.evaluate(() => document.body.focus());
    const q1 = await page.evaluate(() => document.querySelector('.mcq-question').textContent);
    await page.keyboard.press('b');
    await page.waitForTimeout(250);
    const answered = await page.evaluate(() => document.querySelectorAll('#optContainer .option-btn')[1].matches('.correct,.wrong'));
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    const q2 = await page.evaluate(() => document.querySelector('.mcq-question').textContent);
    check('键盘', '快捷键：B 作答、→ 换题', answered && q1 !== q2);
    for (const [btn, box] of [['#syncBtn', '.sync-box'], ['#guideBtn', '.tour-tip']]) {
      await page.evaluate(() => window.navigateHome());
      await page.waitForTimeout(400);
      await page.focus(btn);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      const inside = await page.evaluate(s => document.querySelector(s).contains(document.activeElement), box);
      let stayed = 0;
      for (let k = 0; k < 8; k++) { await page.keyboard.press(k % 3 === 2 ? 'Shift+Tab' : 'Tab'); if (await page.evaluate(s => document.querySelector(s).contains(document.activeElement), box)) stayed++; }
      if (box === '.sync-box') await contrast(page, 'desktop 同步弹窗', '.sync-box', R);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const restored = await page.evaluate(b => document.activeElement === document.querySelector(b), btn);
      check('键盘', `${box === '.sync-box' ? '同步' : '引导'}弹窗：焦点进入、困住、关闭後还原`, inside && stayed === 8 && restored, `进入 ${inside}，困住 ${stayed}/8，还原 ${restored}`);
    }
    check('键盘', '没有 JS 错误', errors.length === 0, errors[0]);
    await ctx.close();
  });

  await section('减少动态', async () => {
    const { ctx, page } = await open({ reducedMotion: 'reduce' });
    await enter(page);
    const r = await page.evaluate(() => ({
      card: getComputedStyle(document.querySelector('.flashcard')).animationName,
      view: getComputedStyle(document.getElementById('viewStudy')).animationName,
    }));
    check('减少动态', '题卡与视图不做滑入动画', r.card === 'none' && r.view === 'none', `题卡 ${r.card}，视图 ${r.view}`);
    await ctx.close();
  });

  await section('背景回应', async () => {
    const now = Date.now();
    const q = bank.sections[1].mcqs[1];
    // 第一章只差第 1 题就全对：用来测「整章都答对」的金光
    const almost = Object.fromEntries(CH1.mcqs.map((_, i) => [i, 'mastered']).slice(1));
    const seed = { UEC_REVIEW_v1: { [`biology__${bank.sections[1].id}__1`]: { ease: 2.3, interval: 3, reps: 1, lapses: 0, last: now - 5 * DAY, due: now - DAY } },
      UEC_PROGRESS_v1: { biology: { [CH1.id]: almost } } };
    const state = page => page.evaluate(() => {
      const l = document.getElementById('customPhotoLayer');
      const leaf = l.querySelector('.scene .is-wide.m-drift');
      return { scene: document.body.classList.contains('has-scene'), on: document.getElementById('subjectBgWash').classList.contains('active'),
        px: l.style.getPropertyValue('--px'), shift: leaf ? getComputedStyle(leaf).translate : '', glow: l.classList.contains('scene-glow') };
    });
    const shines = page => page.evaluate(() => document.getAnimations().filter(a => a.effect && a.effect.getKeyframes().some(k => 'filter' in k)).length);
    const answerReview = async page => {
      await page.evaluate(() => window.switchSubSection('review'));
      await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelector('.review-head .empty-btn').click());
      await page.waitForTimeout(600);
      await page.evaluate(i => document.querySelectorAll('#optContainer .option-btn')[i].click(), q.answer);
      await page.waitForTimeout(150);
    };

    const { ctx, page, errors } = await open({ width: 1440, height: 900, seed });
    await page.evaluate(() => document.querySelectorAll('.orbit-node')[3].click());      // 数学：还没开放
    await page.waitForTimeout(900);
    const chem = await state(page);
    await page.evaluate(() => document.querySelectorAll('.orbit-node')[0].click());      // 生物
    await page.waitForTimeout(1400);
    await page.mouse.move(200, 150);
    await page.mouse.move(1300, 800, { steps: 8 });
    await page.waitForTimeout(1200);
    const bio = await state(page);
    await contrast(page, 'desktop 首页预览（生物）', null, R);
    await shot(page, 'desktop-home-preview');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const off = await state(page);
    await page.evaluate(() => document.querySelectorAll('.orbit-node')[0].click());
    await page.waitForTimeout(1400);
    await page.evaluate(() => { document.querySelector('#customPhotoLayer .scene').dataset.mark = '1'; document.querySelector('.panel-enter').click(); });
    await page.waitForTimeout(1200);
    const kept = await page.evaluate(() => Boolean(document.querySelector('#customPhotoLayer .scene[data-mark]')));
    await page.mouse.move(100, 100, { steps: 4 });
    await page.waitForTimeout(300);
    const study = await state(page);
    await answerReview(page);
    const n = await shines(page);
    const done = await state(page);
    await page.evaluate(() => { window.switchSubSection('mcq'); selectChapter(0); });
    await page.waitForTimeout(500);
    await page.evaluate(i => document.querySelectorAll('#optContainer .option-btn')[i].click(), CH1.mcqs[0].answer);
    await page.waitForTimeout(150);
    const gold = await shines(page);
    check('背景回应', '还没开放的科目，首页不预览', !chem.on && !chem.scene, JSON.stringify(chem));
    check('背景回应', '首页选到生物：淡入那一科的水彩', bio.on && bio.scene);
    check('背景回应', '桌面：图层跟著鼠标往反方向错开', /^-\d/.test(bio.shift), bio.shift);
    check('背景回应', '取消选择：退回首页原本的背景', !off.on && !off.scene && off.px === '0', JSON.stringify(off));
    check('背景回应', '按「进入」：沿用同一张，不清掉重画', kept);
    check('背景回应', '做题页：视差停止', study.px === '0' && !study.glow, JSON.stringify(study));
    check('背景回应', '平常答对一题：背景不动', n === 0, `${n} 个`);
    check('背景回应', '整章都答对（练习）：元素闪一下金光', gold > 0, `${gold} 个`);
    check('背景回应', '做完今日复习：背景透进暖光', done.glow);
    check('背景回应', '没有 JS 错误', errors.length === 0, errors[0]);
    await ctx.close();

    const rm = await open({ width: 1440, height: 900, seed, reducedMotion: 'reduce' });
    await rm.page.evaluate(() => document.querySelectorAll('.orbit-node')[0].click());
    await rm.page.waitForTimeout(1400);
    await rm.page.mouse.move(1300, 800, { steps: 8 });
    await rm.page.waitForTimeout(300);
    const still = await state(rm.page);
    await rm.page.evaluate(() => document.querySelector('.panel-enter').click());
    await rm.page.waitForTimeout(1200);
    await answerReview(rm.page);
    const rdone = await state(rm.page);
    check('背景回应', '减少动态：不跟鼠标，暖光照样出现', still.scene && still.px === '' && rdone.glow, `px「${still.px}」`);
    await rm.ctx.close();

    // 整章测验：这一次交卷让整章全对，也要闪
    const t = await open({ width: 1440, height: 900, seed });
    await enter(t.page);
    await t.page.evaluate(() => document.getElementById('testStartBtn').click());
    await t.page.waitForTimeout(500);
    await t.page.evaluate(ans => document.querySelectorAll('#viewTest fieldset.test-q').forEach((f, i) => f.querySelectorAll('input')[ans[i]].click()),
      CH1.mcqs.map(m => m.answer));
    await t.page.evaluate(() => document.querySelector('.test-submit').click());
    await t.page.waitForTimeout(150);
    const tg = await shines(t.page);
    check('背景回应', '整章都答对（整章测验）：元素闪一下金光', tg > 0, `${tg} 个`);
    check('背景回应', '整章测验没有 JS 错误', t.errors.length === 0, t.errors[0]);
    await t.ctx.close();

    const m = await open({ seed });
    await m.page.evaluate(() => document.querySelectorAll('.orbit-node')[0].click());
    await m.page.waitForTimeout(1400);
    await contrast(m.page, 'mobile 首页预览（生物）', null, R);
    await shot(m.page, 'mobile-home-preview');
    await m.ctx.close();
  });

  await section('护眼模式', async () => {
    const theme = page => page.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), dcl: window.__themeAtDCL,
      saved: localStorage.getItem('UEC_THEME_v1'), pressed: (document.getElementById('themeBtn') || {}).getAttribute && document.getElementById('themeBtn').getAttribute('aria-pressed') }));
    const mark = ctx => ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { window.__themeAtDCL = document.documentElement.getAttribute('data-theme'); }));

    // 装置是深色：一开就是护眼，而且在画面出来之前就定了（不会先闪白）
    const d = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    await mark(d);
    await d.addInitScript(() => { if (!sessionStorage.getItem('__s')) { sessionStorage.setItem('__s', 1); localStorage.setItem('UEC_TOUR_v1', JSON.stringify({ home: 1, study: 1, test: 1, notes: 1, archive: 1, feedback: 1, explain: 1 })); } });
    const dp = await d.newPage(); const derr = []; dp.on('pageerror', e => derr.push(String(e).slice(0, 200)));
    await dp.goto(URL_); await dp.waitForTimeout(800);
    const sys = await theme(dp);
    check('护眼模式', '装置是深色模式：自动进入护眼，第一次画面前就定好', sys.t === 'night' && sys.dcl === 'night' && sys.pressed === 'true', JSON.stringify(sys));
    await dp.evaluate(() => document.querySelectorAll('.orbit-node')[0].click());
    await dp.waitForTimeout(1500);
    await dp.evaluate(() => document.querySelector('.panel-enter').click());
    await dp.waitForTimeout(1800);
    const sc = await dp.evaluate(() => { const p = document.querySelector('#customPhotoLayer .scene-plate'); const l = document.querySelector('#customPhotoLayer .scene img.is-wide');
      return { plate: p ? p.src.split('/').pop() : '', op: l ? getComputedStyle(l).opacity : '' }; });
    check('护眼模式', '水彩换成夜色底图，图层压暗', sc.plate === 'plate-night.webp' && Number(sc.op) < 0.5, JSON.stringify(sc));
    const ans = CH1.mcqs[0].answer;
    await dp.evaluate(a => document.querySelectorAll('#optContainer .option-btn')[(a + 1) % 4].click(), ans);
    await dp.waitForTimeout(700);
    await dp.evaluate(() => scrollTo(0, 0));
    await contrast(dp, 'night desktop 答错後', null, R);
    await shot(dp, 'night-desktop-answered');
    await dp.evaluate(() => window.switchSubSection('wrong'));
    await dp.waitForTimeout(400);
    await contrast(dp, 'night desktop 错题本', null, R);
    // 其他测验把 explain 预设成看过（免得它半途跳出来），导览框改在这里固定叫出来、淡入完再量
    await dp.evaluate(() => { window.switchSubSection('mcq'); window.UECOnboarding.start('explain'); });
    await dp.waitForTimeout(600);
    await contrast(dp, 'night desktop 导览', '.tour-tip', R);
    await dp.keyboard.press('Escape');
    await dp.evaluate(() => { window.switchSubSection('mcq'); document.getElementById('testStartBtn').click(); });
    await dp.waitForTimeout(500);
    await dp.evaluate(() => document.querySelectorAll('#viewTest fieldset.test-q').forEach(f => f.querySelector('input').click()));
    await dp.evaluate(() => document.querySelector('.test-submit').click());
    await dp.waitForTimeout(500);
    await contrast(dp, 'night desktop 测验结果', null, R);
    await dp.evaluate(() => { const b = [...document.querySelectorAll('#viewTest button')].find(x => /返回练习/.test(x.textContent)); b && b.click(); openArchiveView(); });
    await dp.waitForTimeout(600);
    await contrast(dp, 'night desktop 题目档', null, R);
    const pdf = await dp.evaluate(() => getComputedStyle(document.getElementById('pdfStage')).getPropertyValue('--text-main').trim());
    check('护眼模式', 'PDF 汇出区保持白纸黑字', pdf === '#0f172a', pdf);
    await dp.emulateMedia({ colorScheme: 'light' });
    await dp.waitForTimeout(300);
    const follow = await theme(dp);
    check('护眼模式', '没手动选过：装置切回浅色就跟著切回', follow.t === 'day', JSON.stringify(follow));
    check('护眼模式', '没有 JS 错误', derr.length === 0, derr[0]);
    await d.close();

    // 装置是浅色：手动开 → 记住；再关 → 跟装置一样，清掉纪录回到跟随
    const { ctx, page, errors } = await open({ width: 390, height: 844, mobile: true });
    const rows = () => page.evaluate(() => new Set([...document.querySelectorAll('.util-actions .sound-toggle')].map(b => Math.round(b.getBoundingClientRect().top))).size);
    const r0 = await rows();
    await page.evaluate(() => document.getElementById('themeBtn').click());
    const on = await theme(page);
    await page.reload(); await page.waitForTimeout(800);
    const kept = await theme(page);
    const r1 = await rows();
    await page.evaluate(() => document.querySelectorAll('.orbit-node')[0].click());
    await page.waitForTimeout(1500);
    await contrast(page, 'night mobile 首页预览', null, R);
    await shot(page, 'night-mobile-home');
    await page.evaluate(() => document.querySelector('.panel-enter').click());
    await page.waitForTimeout(1500);
    await contrast(page, 'night mobile 做题', null, R);
    await page.evaluate(() => document.getElementById('syncBtn').click());
    await page.waitForTimeout(600);
    await contrast(page, 'night mobile 同步', '.sync-box', R);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('themeBtn').click());
    const off = await theme(page);
    check('护眼模式', '手动开启：记住选择，重新整理後还是护眼', on.t === 'night' && on.saved === 'night' && kept.t === 'night', `${JSON.stringify(on)} → ${JSON.stringify(kept)}`);
    check('护眼模式', '再按一次关掉：跟装置一样，清掉纪录回到跟随装置', off.t === 'day' && off.saved === null && off.pressed === 'false', JSON.stringify(off));
    check('护眼模式', '390px：多了护眼按钮，工具列仍然一行', r0 === 1 && r1 === 1, `白天 ${r0} 行、护眼 ${r1} 行`);
    check('护眼模式', '没有 JS 错误（手机）', errors.length === 0, errors[0]);
    await ctx.close();
  });

  await section('零题科目', async () => {
    const { ctx, page, errors } = await open({ width: 1440, height: 900 });
    await contrast(page, 'desktop 首页', null, R);
    await page.evaluate(() => document.querySelectorAll('.orbit-node')[1].click());
    await page.waitForTimeout(600);
    const panel = await page.evaluate(() => { const e = document.querySelector('.panel-enter'); return { text: e.textContent, quiet: e.classList.contains('is-quiet') }; });
    check('零题科目', '轨道面板：主按钮降级为「看章节大纲」', panel.quiet && panel.text === '看章节大纲', panel.text);
    await contrast(page, 'desktop 轨道面板（化学）', '#orbitStage', R);
    await page.evaluate(() => document.querySelector('.panel-enter').click());
    await page.waitForTimeout(1100);
    const r = await page.evaluate(() => ({ title: (document.querySelector('.empty-title') || {}).textContent || '',
      bar: getComputedStyle(document.querySelector('.sub-bookmark-bar')).display }));
    check('零题科目', '进去是诚实的终点，并收起四个分页', r.title.includes('还没开始') && r.bar === 'none', r.title);
    check('零题科目', '没有 JS 错误', errors.length === 0, errors[0]);
    await contrast(page, 'desktop 化学空科目', null, R);
    await ctx.close();
  });

  for (const vp of [{ width: 390, height: 844, mobile: true, tag: 'mobile' }, { width: 1440, height: 900, mobile: false, tag: 'desktop' }]) {
    await section(`整章测验（${vp.tag}）`, async () => {
      const G = `整章测验（${vp.tag}）`;
      const { ctx, page, errors } = await open(vp);
      await enter(page);
      await page.evaluate(() => document.getElementById('testStartBtn').click());
      await page.waitForTimeout(500);
      const s = await page.evaluate(() => ({
        nav: getComputedStyle(document.querySelector('.top-nav')).display,
        n: document.querySelectorAll('#viewTest fieldset.test-q').length,
        legendInside: (() => { const f = document.querySelector('#viewTest fieldset.test-q'); return f.querySelector('legend').getBoundingClientRect().top >= f.getBoundingClientRect().top + 4; })(),
        overflow: document.documentElement.scrollWidth - innerWidth,
        ws: getComputedStyle(document.querySelector('#viewTest .test-q-text')).whiteSpace,
      }));
      check(G, '进入後隐藏导航，一次列出整章', s.nav === 'none' && s.n === CH1.mcqs.length, `${s.n} 题`);
      check(G, '题干照题库换行（罗马数字叙述 I、II…各占一行）', s.ws === 'pre-line', s.ws);
      check(G, '题号与题干在卡片里、无横向溢出', s.legendInside && s.overflow === 0);
      if (vp.tag === 'mobile') { await contrast(page, 'mobile 测验作答', null, R); await shot(page, 'mobile-test-form'); }
      await page.evaluate(() => document.querySelector('.test-submit').click());
      await page.waitForTimeout(500);
      const miss = await page.evaluate(() => document.querySelectorAll('.test-q.is-missing').length);
      check(G, '没答完不能交卷，漏掉的题会标出来', miss === s.n, `标出 ${miss} 题`);
      await page.evaluate(() => document.querySelectorAll('#viewTest fieldset.test-q').forEach(f => f.querySelector('input').click()));
      await page.evaluate(() => document.querySelector('.test-exit').click());
      await page.waitForTimeout(250);
      const cf = await page.evaluate(() => ({ shown: !document.querySelector('.test-confirm').hidden, focus: document.activeElement.textContent }));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const still = await page.evaluate(() => document.getElementById('viewTest').classList.contains('active') && document.querySelector('.test-confirm').hidden);
      check(G, '作答中退出要确认，预设停在「继续作答」，Esc 取消', cf.shown && cf.focus === '继续作答' && still);
      await page.evaluate(() => document.querySelector('.test-submit').click());
      await page.waitForTimeout(700);
      const rec1 = await page.evaluate(() => localStorage.getItem('UEC_REVIEW_v1'));
      const keys = Object.keys(JSON.parse(rec1 || '{}')).length;
      check(G, '交卷後每题记一次', keys === s.n, `${keys} 笔纪录`);
      if (vp.tag === 'mobile') { await contrast(page, 'mobile 测验结果', null, R); await shot(page, 'mobile-test-result'); }
      else await shot(page, 'desktop-test-result');
      const redo = await page.evaluate(() => { const b = [...document.querySelectorAll('.test-actions .test-btn')].find(x => x.textContent.startsWith('重做')); if (b) b.click(); return !!b; });
      if (redo) {
        await page.waitForTimeout(400);
        await page.evaluate(() => document.querySelectorAll('#viewTest fieldset.test-q').forEach(f => f.querySelectorAll('input')[1].click()));
        await page.evaluate(() => document.querySelector('.test-submit').click());
        await page.waitForTimeout(600);
        const rec2 = await page.evaluate(() => localStorage.getItem('UEC_REVIEW_v1'));
        check(G, '重做不写进复习排程', rec2 === rec1);
      }
      await page.evaluate(() => [...document.querySelectorAll('.test-actions .test-btn')].find(x => x.textContent === '返回练习').click());
      await page.waitForTimeout(600);
      const back = await page.evaluate(() => ({ study: document.getElementById('viewStudy').classList.contains('active'), focus: document.activeElement.id }));
      check(G, '返回练习，焦点回到「开始测验」', back.study && back.focus === 'testStartBtn');
      await page.evaluate(() => document.getElementById('testStartBtn').click());
      await page.waitForTimeout(300);
      await page.evaluate(() => document.querySelector('#viewTest input').click());
      let dialog = null;
      page.on('dialog', async d => { dialog = d.type(); await d.dismiss(); });
      check(G, '没有 JS 错误', errors.length === 0, errors[0]);
      await page.close({ runBeforeUnload: true });
      await new Promise(r => setTimeout(r, 600));
      check(G, '作答中关闭分页会被拦下', dialog === 'beforeunload');
      await ctx.close();
    });
  }

  await section('模拟统考', async () => {
    // 开了模拟统考放著不管、时间到自动交卷：没答的算错，但不能写进错题本与复习排程（曾经整份 40 题都被记成错题）
    const { ctx, page, errors } = await open({ width: 1440, height: 900, clock: true });
    await enter(page);
    await page.evaluate(() => document.getElementById('mockExamBtn').click());
    // 第一次进来：导览自己出现（换画面後 0.7 秒）；导览开着时计时不走，关掉才开始倒数
    await page.waitForTimeout(1500);
    const clockText = () => page.evaluate(() => document.querySelector('.test-clock').textContent);
    const tour = await page.evaluate(() => (document.querySelector('.tour-tip .tour-title') || {}).textContent);
    const c0 = await clockText();
    await page.clock.fastForward(5 * 60e3);
    const c1 = await clockText();
    check('模拟统考', '第一次进来：导览开着时计时不走', tour === '模拟统考' && c1 === c0, `导览「${tour}」，${c0} → ${c1}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const esc = await page.evaluate(() => ({ tour: !!document.querySelector('.tour-tip'), confirm: !document.querySelector('.test-confirm').hidden }));
    await page.clock.fastForward(60e3);
    const c2 = await clockText();
    check('模拟统考', '按 Esc 关掉导览：开始倒数，不会跳出「退出测验」', !esc.tour && !esc.confirm && c2 !== c0, `${JSON.stringify(esc)}，${c0} → ${c2}`);
    const minutes = Number(await page.evaluate(() => document.getElementById('mockExamLabel').textContent.match(/(\d+) 分钟/)[1]));
    await page.evaluate(() => document.querySelector('#viewTest fieldset.test-q input').click());
    await page.clock.fastForward(minutes * 60e3 + 2000);
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => ({ done: !!document.querySelector('.test-result'),
      review: Object.keys(JSON.parse(localStorage.getItem('UEC_REVIEW_v1') || '{}')).length,
      progress: Object.values(JSON.parse(localStorage.getItem('UEC_PROGRESS_v1') || '{}')).reduce((n, s) => n + Object.values(s).reduce((m, ch) => m + Object.keys(ch).length, 0), 0) }));
    check('模拟统考', '时间到自动交卷', r.done);
    check('模拟统考', '只答了一题：错题本与复习排程只多一笔', r.review === 1 && r.progress === 1, `复习 ${r.review} 笔、进度 ${r.progress} 笔`);
    const rec1 = await page.evaluate(() => localStorage.getItem('UEC_REVIEW_v1'));
    await page.evaluate(() => [...document.querySelectorAll('.test-actions .test-btn')].find(x => x.textContent.startsWith('重做')).click());
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelectorAll('#viewTest fieldset.test-q').forEach(f => f.querySelector('input').click()));
    await page.evaluate(() => document.querySelector('.test-submit').click());
    await page.waitForTimeout(600);
    check('模拟统考', '看过解析再重做没答的题，也不写进复习排程', await page.evaluate(() => localStorage.getItem('UEC_REVIEW_v1')) === rec1);
    check('模拟统考', '没有 JS 错误', errors.length === 0, errors[0]);
    await ctx.close();
  });

  // 对比度汇总：同一个元素同一种颜色只算一次，取最差的那个样本
  const uniq = {};
  R.forEach(x => { const k = x.sel + '|' + x.fg; if (!uniq[k] || x.r < uniq[k].r) uniq[k] = x; });
  const all = Object.values(uniq);
  const fails = all.filter(x => x.r < x.need).sort((a, b) => a.r - b.r);
  check('对比度', `${all.length} 组文字 / 背景全部达 WCAG AA`, fails.length === 0,
    fails.length ? fails.slice(0, 6).map(x => `${x.r}:1 ${x.sel} 「${x.txt}」 [${x.view}]`).join('\n        ')
      : `最薄余量 ${all.sort((a, b) => (a.r - a.need) - (b.r - b.need))[0].r}:1`);
}

(async () => {
  const exe = findChrome();
  try { browser = await chromium.launch({ executablePath: exe }); }
  catch (e) {
    console.error('找不到 Chromium。请在 scripts/ui-check 里执行：npx playwright-core install chromium\n（或设定 CHROME_PATH 指向 Chrome／Chromium）');
    process.exit(2);
  }
  const { server, url } = await serve();
  URL_ = url;
  const t0 = Date.now();
  try { await run(); }
  finally { await browser.close(); server.close(); }

  let group = '';
  for (const r of results) {
    if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}${!r.pass && r.detail ? `\n        ${r.detail}` : (r.pass && r.detail && r.group === '对比度' ? `（${r.detail}）` : '')}`);
  }
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${failed ? '❌' : '✅'} ${results.length - failed} / ${results.length} 通过，用时 ${Math.round((Date.now() - t0) / 1000)} 秒。截图在 ${path.relative(process.cwd(), OUT) || OUT}/`);
  process.exit(failed ? 1 : 0);
})();
