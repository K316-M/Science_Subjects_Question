/* ==========================================================================
   开发者工作台
   ========================================================================== */

const SUBJECTS = ['biology', 'chemistry', 'physics'];
const SUBJECT_LABEL = { biology: '生物', chemistry: '化学', physics: '物理' };
const VIEW_LABEL = {
  viewSubjects: '主页（学科选择）',
  viewStudy: '做题页',
  viewNotes: '笔记页',
  viewArchive: '题目档页',
  viewFeedback: '网页问题申诉页',
};
const SUB_MODE_LABEL = { mcq: '选择题', subj: '做答题', wrong: '错题本' };
const LEVEL = {
  critical: { label: '严重', icon: 'xCircle', cls: 'status-critical' },
  serious: { label: '待确认', icon: 'warning', cls: 'status-serious' },
  warning: { label: '提醒', icon: 'info', cls: 'status-warning' },
};
const REPO_URL = 'https://github.com/K316-M/Science_Subjects_Question';

const state = {
  session: null,
  banks: {},
  pending: [],
  resolutions: [],
  resolutionsSource: 'static',
  issues: [],
  imageIssues: [],
  imageCheckDone: false,
  overviewSubject: 'biology',
  overviewView: 'chart',
  inspectorSubject: 'all',
  inspectorLevel: 'all',
  editorQuery: '',
  editorSubject: 'all',
  editorChapter: '',
  editorHiddenOnly: false,
  parsedReport: null,
};

const ROUTES = {
  overview: { label: '总览', icon: 'grid', title: '总览', desc: '题库规模、巡检结果与待办事项一览。', render: renderOverview },
  issues: { label: '申诉处理', icon: 'inbox', title: '申诉处理', desc: '学生的申诉会寄到你的 Formspree 邮箱。把邮件里的「开发者处理码」贴进来，写好处理说明后发布，学生下次开站就会看到通知小精灵。', render: renderIssues },
  inspector: { label: '题库巡检', icon: 'shield', title: '题库巡检', desc: '自动检查三科题库里的格式问题：选项数量、答案序号、缺少配图与解析、重复题目、图片死链。', render: renderInspector },
  pending: { label: 'AI 录题待审', icon: 'sparkles', title: 'AI 录题待审', desc: '被自动检查标出问题的题逐题展开，可以直接改文字、换配图再采纳；没问题的收成一张清单，扫过一遍一键采纳。', render: renderPending },
  editor: { label: '题目修改', icon: 'edit', title: '题目修改', desc: '搜寻或按章节浏览已上线的题目：直接改题干、选项、答案、解析、换配图，或下架不要的题。存档後约一分钟自动部署，学生就看得到。', render: renderEditor },
  local: { label: '本机调试', icon: 'terminal', title: '本机调试', desc: '查看、导出或清除这台设备上学生站留下的本地数据，并能生成测试通知来预览小精灵。', render: renderLocal },
};

/* ---------- 启动 ---------- */
async function boot() {
  const { ok, status, data } = await api('/api/dev-session');
  if (!ok) {
    document.getElementById('bootText').textContent = status === 0 ? '无法连接服务器，请检查网络后刷新。' : `验证失败（${status}），请刷新重试。`;
    document.querySelector('#boot .spinner').remove();
    return;
  }
  if (!data.authenticated) {
    window.location.replace('/dev/login.html');
    return;
  }
  state.session = data;

  setupShell();
  await loadData();
  document.getElementById('boot').remove();
  document.getElementById('app').hidden = false;
  navigate();
  window.addEventListener('hashchange', navigate);
}

function setupShell() {
  const { username, expiresAt } = state.session;
  document.getElementById('userName').textContent = username;
  document.getElementById('avatar').textContent = (username || 'D').slice(0, 1).toUpperCase();
  document.getElementById('sessionInfo').textContent = `登录至 ${new Date(expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;

  const nav = document.getElementById('nav');
  Object.entries(ROUTES).forEach(([key, r]) => {
    nav.appendChild(el('a', { class: 'nav-link', attrs: { href: `#${key}`, 'data-route': key } },
      icon(r.icon), el('span', { text: r.label }), el('span', { class: 'nav-count', attrs: { 'data-count-for': key }, hidden: true })));
  });

  document.getElementById('openSiteLink').prepend(icon('external'));
  document.getElementById('logoutBtn').prepend(icon('logout'));
  document.getElementById('logoutBtn').addEventListener('click', logout);

  const menuBtn = document.getElementById('menuBtn');
  menuBtn.appendChild(icon('menu'));
  const app = document.getElementById('app');
  const scrim = document.getElementById('scrim');
  const setDrawer = (open) => {
    app.classList.toggle('drawer-open', open);
    scrim.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  };
  menuBtn.addEventListener('click', () => setDrawer(!app.classList.contains('drawer-open')));
  scrim.addEventListener('click', () => setDrawer(false));
  nav.addEventListener('click', () => setDrawer(false));
}

async function logout() {
  await api('/api/dev-logout', { method: 'POST' });
  window.location.replace('/dev/login.html');
}

function handleUnauthenticated(status) {
  if (status === 401) {
    toast('登录已过期，请重新登录', 'critical');
    setTimeout(() => window.location.replace('/dev/login.html'), 1200);
    return true;
  }
  return false;
}

/* ---------- 数据 ---------- */
async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

const canPublish = () => Boolean(state.session.publishing && state.session.publishing.enabled);

async function loadData() {
  // 能发布就直接读 GitHub 上最新的：网站上的 /papers 要等部署完才更新，刚存的修改会「消失」一下
  let fresh = null;
  if (canPublish()) {
    const { ok, status, data } = await api('/api/dev-edit');
    if (handleUnauthenticated(status)) return;
    if (ok) fresh = data;
  }
  const [bio, chem, phys, pending] = fresh
    ? [fresh.banks.biology, fresh.banks.chemistry, fresh.banks.physics, fresh.pending]
    : await Promise.all([
      fetchJson('/papers/biology_question_bank.json'),
      fetchJson('/papers/chemistry_question_bank.json'),
      fetchJson('/papers/physics_question_bank.json'),
      fetchJson('/papers/pending_approval.json'),
    ]);
  state.banks = {
    biology: (bio && bio.sections) || [],
    chemistry: (chem && chem.sections) || [],
    physics: (phys && phys.sections) || [],
  };
  state.pending = (pending && Array.isArray(pending.items)) ? pending.items : [];
  await loadResolutions();
  state.issues = inspectBanks();
  updateNavCounts();
}

async function loadResolutions() {
  if (state.session.publishing && state.session.publishing.enabled) {
    const { ok, status, data } = await api('/api/dev-resolutions');
    if (handleUnauthenticated(status)) return;
    if (ok) {
      state.resolutions = data.resolutions || [];
      state.resolutionsSource = 'github';
      return;
    }
  }
  const stat = await fetchJson('/data/resolved_issues.json');
  state.resolutions = (stat && stat.resolutions) || [];
  state.resolutionsSource = 'static';
}

function updateNavCounts() {
  const counts = {
    inspector: state.issues.filter(i => i.level === 'critical').length + state.imageIssues.length,
    pending: state.pending.length,
  };
  document.querySelectorAll('[data-count-for]').forEach(badge => {
    const n = counts[badge.getAttribute('data-count-for')];
    badge.hidden = !n;
    badge.textContent = n || '';
  });
}

/* ---------- 路由 ---------- */
function navigate() {
  const key = (window.location.hash || '#overview').slice(1);
  const route = ROUTES[key] || ROUTES.overview;
  const routeKey = ROUTES[key] ? key : 'overview';
  document.querySelectorAll('.nav-link[data-route]').forEach(a => {
    if (a.getAttribute('data-route') === routeKey) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${route.title} · 开发者工作台`;
  const main = clear(document.getElementById('main'));
  main.appendChild(el('div', { class: 'page-head' },
    el('div', {}, el('h1', { class: 'page-title', text: route.title }), el('p', { class: 'page-desc', text: route.desc })),
    el('div', { class: 'page-actions', attrs: { id: 'pageActions' } })));
  const body = el('div', { class: 'stack' });
  main.appendChild(body);
  route.render(body, document.getElementById('pageActions'));
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/* ==========================================================================
   题库巡检规则
   ========================================================================== */
const FIGURE_WORDS = /如图|下图|图中|图示|示意图|曲线图|装置图|见图|右图|左图/;

// 与 scripts/qa.py 的 text_problems 同一套规则、同样的字句（待审区靠字句去重），
// 已上线的题与还没跑过新检查的待审题也能被抓出来
const ENGLISH_FILLER = /(^|[^A-Za-z])(and|or|the|of|is|are|not|which|with|what)(?![A-Za-z])/i;
const LEFTOVER_MARK = /\[\/?标记[^\]]*\]|\[图\d+\]/;
const LEADING_NUMBER = /^\s*(\d{1,3}|[（(]\d{1,3}[)）])\s*[.．、)]/;

function textLint(item) {
  const out = [];
  const stem = String(item.q || item.question || '');
  const pieces = [['题干', stem], ...(item.options || []).map((o, i) => [`选项${'ABCD'[i]}`, o])];
  pieces.forEach(([label, raw]) => {
    const text = String(raw || '');
    const en = /[\u4e00-\u9fff]/.test(text) && text.match(ENGLISH_FILLER);
    if (en) out.push(`${label}夹了英文「${en[2]}」，疑似转写错误`);
    const mark = text.match(LEFTOVER_MARK);
    if (mark) out.push(`${label}残留转写标记「${mark[0]}」`);
  });
  if (LEADING_NUMBER.test(stem)) out.push('题干开头的题号没去掉');
  return out;
}

function inspectBanks() {
  const issues = [];
  SUBJECTS.forEach(subject => {
    const seen = new Map();
    state.banks[subject].forEach((sec, chapterIdx) => {
      const base = { subject, chapterIdx, chapterTitle: sec.title };
      (sec.mcqs || []).forEach((item, qIndex) => {
        if (item.hidden) return;   // 已下架，学生看不到，不用巡检
        const at = { ...base, type: 'mcq', qIndex, item };
        const opts = Array.isArray(item.options) ? item.options : [];
        if (!String(item.q || '').trim()) issues.push({ ...at, level: 'critical', label: '题干为空' });
        if (opts.length !== 4) issues.push({ ...at, level: 'critical', label: `选项有 ${opts.length} 个，应为 4 个` });
        if (!Number.isInteger(item.answer) || item.answer < 0 || item.answer >= Math.max(opts.length, 1)) {
          issues.push({ ...at, level: 'critical', label: '答案序号超出选项范围' });
        }
        if (FIGURE_WORDS.test(item.q || '') && !item.image && !item.figure) {
          issues.push({ ...at, level: 'serious', label: '题干提到图，但没有配图' });
        }
        if (!String(item.explanation || '').trim()) issues.push({ ...at, level: 'warning', label: '缺少解析' });
        textLint(item).forEach(label => issues.push({ ...at, level: 'serious', label }));
        const key = String(item.q || '').replace(/\s+/g, '');
        if (key) {
          if (seen.has(key)) issues.push({ ...at, level: 'warning', label: `与 ${seen.get(key)} 重复` });
          else seen.set(key, `${sec.title.split(/[：:]/)[0]} 第 ${qIndex + 1} 题`);
        }
      });
      (sec.subjectives || []).forEach((item, qIndex) => {
        if (item.hidden) return;
        const at = { ...base, type: 'subj', qIndex, item };
        if (!String(item.question || '').trim()) issues.push({ ...at, level: 'critical', label: '题干为空' });
        if (!String(item.answer || '').trim()) issues.push({ ...at, level: 'critical', label: '做答题缺少参考答案' });
        if (FIGURE_WORDS.test(item.question || '') && !item.image && !item.figure) {
          issues.push({ ...at, level: 'serious', label: '题干提到图，但没有配图' });
        }
        textLint(item).forEach(label => issues.push({ ...at, level: 'serious', label }));
      });
    });
  });
  return issues;
}

async function checkImageLinks() {
  const found = [];
  const jobs = [];
  SUBJECTS.forEach(subject => {
    state.banks[subject].forEach((sec, chapterIdx) => {
      [['mcq', sec.mcqs || []], ['subj', sec.subjectives || []]].forEach(([type, list]) => {
        list.forEach((item, qIndex) => {
          if (!item.image || /^https?:/i.test(item.image)) return;
          const url = '/' + String(item.image).replace(/^\.?\//, '');
          jobs.push(fetch(url, { method: 'HEAD', cache: 'no-cache' })
            .then(res => { if (!res.ok) found.push({ subject, chapterIdx, chapterTitle: sec.title, type, qIndex, item, level: 'serious', label: `图片死链：${item.image}` }); })
            .catch(() => {}));
        });
      });
    });
  });
  await Promise.all(jobs);
  state.imageIssues = found;
  state.imageCheckDone = true;
  updateNavCounts();
}

/* ==========================================================================
   总览
   ========================================================================== */
function statTile({ label, iconName, value, unit, foot, meter }) {
  return el('div', { class: 'card stat spotlight' },
    el('div', { class: 'stat-label' }, icon(iconName), el('span', { text: label })),
    el('div', { class: 'stat-value' }, String(value), unit ? el('small', { text: unit }) : null),
    meter != null ? el('div', { class: 'meter', attrs: { role: 'img', 'aria-label': `${Math.round(meter * 100)}%` } },
      el('span', { style: `width:${Math.max(0, Math.min(1, meter)) * 100}%` })) : null,
    foot ? (foot.nodeType ? foot : el('div', { class: 'stat-foot', text: foot })) : null);
}

function totals() {
  let mcq = 0, subj = 0, chapters = 0, covered = 0;
  SUBJECTS.forEach(s => state.banks[s].forEach(sec => {
    const m = (sec.mcqs || []).length;
    const j = (sec.subjectives || []).length;
    mcq += m; subj += j; chapters += 1;
    if (m + j > 0) covered += 1;
  }));
  return { mcq, subj, chapters, covered };
}

function renderOverview(body) {
  const t = totals();
  const allIssues = state.issues.concat(state.imageIssues);
  const byLevel = lvl => allIssues.filter(i => i.level === lvl).length;
  const pub = state.session.publishing || {};

  const issueFoot = allIssues.length === 0
    ? el('div', { class: 'status status-good', style: 'margin-top:6px' }, icon('checkCircle'), el('span', { text: '全部通过' }))
    : el('div', { class: 'stat-foot', text: `严重 ${byLevel('critical')} · 待确认 ${byLevel('serious')} · 提醒 ${byLevel('warning')}` });

  body.appendChild(el('div', { class: 'kpi-row' },
    statTile({ label: '题目总数', iconName: 'book', value: (t.mcq + t.subj).toLocaleString('zh-CN'), unit: '题', foot: `选择题 ${t.mcq} · 做答题 ${t.subj}` }),
    statTile({ label: '章节覆盖', iconName: 'layers', value: t.covered, unit: `/ ${t.chapters} 章`, meter: t.chapters ? t.covered / t.chapters : 0, foot: '至少有一题的章节' }),
    statTile({ label: '巡检发现', iconName: 'shield', value: allIssues.length, unit: '项', foot: issueFoot }),
    statTile({ label: 'AI 录题待审', iconName: 'sparkles', value: state.pending.length, unit: '题', foot: state.pending.length ? '到「AI 录题待审」采纳后上线' : '目前没有待审批次' }),
    statTile({ label: '已发布处理', iconName: 'inbox', value: state.resolutions.length, unit: '条', foot: pub.enabled ? '一键发布：已连接 GitHub' : '一键发布：未配置' })));

  // 筛选放在图表卡片上方（整页只有这一个维度）
  const filterRow = el('div', { class: 'row' });
  const seg = el('div', { class: 'segmented', attrs: { role: 'group', 'aria-label': '选择科目' } });
  SUBJECTS.forEach(s => seg.appendChild(el('button', {
    type: 'button', text: SUBJECT_LABEL[s], attrs: { 'aria-pressed': String(state.overviewSubject === s) },
    onclick: () => { state.overviewSubject = s; navigate(); },
  })));
  filterRow.appendChild(seg);
  body.appendChild(filterRow);

  const sections = state.banks[state.overviewSubject];
  const rows = sections.map((sec, i) => ({
    label: String(i + 1),
    title: sec.title,
    mcq: (sec.mcqs || []).length,
    subj: (sec.subjectives || []).length,
  }));
  const hasAny = rows.some(r => r.mcq + r.subj > 0);

  const viewToggle = el('button', {
    class: 'btn btn-sm', type: 'button',
    attrs: { 'aria-pressed': String(state.overviewView === 'table') },
    onclick: () => { state.overviewView = state.overviewView === 'chart' ? 'table' : 'chart'; navigate(); },
  }, icon(state.overviewView === 'chart' ? 'table' : 'chart'), el('span', { text: state.overviewView === 'chart' ? '表格' : '图表' }));

  const card = el('div', { class: 'card' },
    el('div', { class: 'chart-head' },
      el('div', {},
        el('div', { class: 'card-title', text: `${SUBJECT_LABEL[state.overviewSubject]}科 · 各章题量` }),
        el('div', { class: 'card-sub', text: `共 ${rows.length} 章，按章节顺序` })),
      el('div', { class: 'row' },
        hasAny ? el('div', { class: 'legend' },
          el('span', { class: 'legend-item' }, el('span', { class: 'legend-swatch', style: 'background:var(--series-1)' }), '选择题'),
          el('span', { class: 'legend-item' }, el('span', { class: 'legend-swatch', style: 'background:var(--series-2)' }), '做答题')) : null,
        hasAny ? viewToggle : null)));

  if (!hasAny) {
    card.appendChild(el('div', { class: 'empty' }, icon('book'), el('div', { text: '这一科还没有题目。可以把试卷照片放进 drafts/ 让 AI 自动录题。' })));
  } else if (state.overviewView === 'table') {
    card.appendChild(chapterTable(rows));
  } else {
    const wrap = el('div', { class: 'chart-wrap' });
    card.appendChild(wrap);
    requestAnimationFrame(() => drawStackedColumns(wrap, rows));
  }
  body.appendChild(card);
}

function chapterTable(rows) {
  return el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', { text: '章节' }), el('th', { class: 'num', text: '选择题' }), el('th', { class: 'num', text: '做答题' }), el('th', { class: 'num', text: '合计' }))),
    el('tbody', {}, rows.map(r => el('tr', {},
      el('td', { text: r.title }), el('td', { class: 'num', text: r.mcq }), el('td', { class: 'num', text: r.subj }), el('td', { class: 'num', text: r.mcq + r.subj }))))));
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / p;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
}

function roundedTopPath(x, y, w, h, r) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function drawStackedColumns(wrap, rows) {
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  };

  const render = () => {
    clear(wrap);
    const W = Math.max(wrap.clientWidth, 280);
    const padL = 30, padR = 6, padT = 22, plotH = 210, axisH = 26;
    const H = padT + plotH + axisH;
    const plotW = W - padL - padR;
    const maxTotal = Math.max(...rows.map(r => r.mcq + r.subj), 1);
    const step = niceStep(maxTotal / 4);
    const yMax = Math.ceil(maxTotal / step) * step;
    const y = v => padT + plotH - (v / yMax) * plotH;
    const slot = plotW / rows.length;
    const barW = Math.max(4, Math.min(24, slot * 0.62));
    const labelEvery = slot >= 18 ? 1 : slot >= 9 ? 2 : 5;

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'group', 'aria-label': '各章题量堆叠柱状图' });

    for (let v = 0; v <= yMax; v += step) {
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: v === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1, 'shape-rendering': 'crispEdges' }));
      const t = svgEl('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis-text' });
      t.textContent = v;
      svg.appendChild(t);
    }

    const maxIdx = rows.findIndex(r => r.mcq + r.subj === maxTotal);
    const tooltip = el('div', { class: 'tooltip', attrs: { role: 'presentation' } });

    rows.forEach((r, i) => {
      const cx = padL + slot * i + slot / 2;
      const x = cx - barW / 2;
      const g = svgEl('g', { class: 'bar-group', tabindex: 0, role: 'img', 'aria-label': `${r.title}：选择题 ${r.mcq} 题，做答题 ${r.subj} 题` });
      g.appendChild(svgEl('rect', { class: 'bar-hit', x: padL + slot * i, y: padT, width: slot, height: plotH, rx: 4 }));

      const total = r.mcq + r.subj;
      if (total > 0) {
        const hM = (r.mcq / yMax) * plotH;
        const hS = (r.subj / yMax) * plotH;
        if (r.mcq > 0) {
          const d = r.subj > 0
            ? `M${x},${y(0)}V${y(0) - hM}H${x + barW}V${y(0)}Z`
            : roundedTopPath(x, y(0) - hM, barW, hM, 4);
          g.appendChild(svgEl('path', { class: 'bar-seg', d, fill: 'var(--series-1)' }));
        }
        if (r.subj > 0) {
          const gap = r.mcq > 0 ? 2 : 0;
          const top = y(0) - hM - hS;
          const h = Math.max(1, hS - gap);
          g.appendChild(svgEl('path', { class: 'bar-seg', d: roundedTopPath(x, top, barW, h, 4), fill: 'var(--series-2)' }));
        }
        if (i === maxIdx) {
          const lbl = svgEl('text', { x: cx, y: y(total) - 7, 'text-anchor': 'middle', class: 'value-label' });
          lbl.textContent = total;
          svg.appendChild(lbl);
        }
      }

      if (i % labelEvery === 0 || i === rows.length - 1) {
        const t = svgEl('text', { x: cx, y: padT + plotH + 17, 'text-anchor': 'middle', class: 'axis-text' });
        t.textContent = r.label;
        svg.appendChild(t);
      }

      const show = () => {
        clear(tooltip);
        tooltip.appendChild(el('div', { class: 'tt-title', text: r.title }));
        [['var(--series-1)', r.mcq, '选择题'], ['var(--series-2)', r.subj, '做答题']].forEach(([c, v, n]) => {
          tooltip.appendChild(el('div', { class: 'tt-row' },
            el('span', { class: 'tt-key', style: `background:${c}` }), el('span', { class: 'tt-val', text: v }), el('span', { class: 'tt-name', text: n })));
        });
        tooltip.appendChild(el('div', { class: 'tt-row', style: 'margin-top:6px' },
          el('span', { class: 'tt-key', style: 'background:transparent' }), el('span', { class: 'tt-val', text: total }), el('span', { class: 'tt-name', text: '合计' })));
        tooltip.classList.add('show');
        const tw = tooltip.offsetWidth;
        const left = Math.min(Math.max(cx - tw / 2, 0), W - tw);
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${Math.max(0, y(total) - tooltip.offsetHeight - 12)}px`;
      };
      const hide = () => tooltip.classList.remove('show');
      g.addEventListener('pointerenter', show);
      g.addEventListener('pointerleave', hide);
      g.addEventListener('focus', show);
      g.addEventListener('blur', hide);
      svg.appendChild(g);
    });

    wrap.appendChild(svg);
    wrap.appendChild(tooltip);
  };

  render();
  const ro = new ResizeObserver(() => {
    if (!wrap.isConnected) { ro.disconnect(); return; }
    render();
  });
  ro.observe(wrap);
}

/* ==========================================================================
   申诉处理
   ========================================================================== */
function decodeDevCode(text) {
  const match = String(text || '').match(/UECFB:([A-Za-z0-9_-]+)/);
  if (!match) return null;
  try {
    let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    if (!/^fb_[a-z0-9]{4,40}$/.test(obj.i || '')) return null;
    return { id: obj.i, location: obj.l || null, message: obj.m || '', createdAt: obj.t || null };
  } catch (e) {
    return null;
  }
}

function describeTarget(t) {
  if (!t) return '—';
  const base = VIEW_LABEL[t.view] || t.view;
  if (t.view === 'viewStudy' && t.subject) {
    return `${SUBJECT_LABEL[t.subject] || t.subject}科 · 第 ${(t.chapterIdx || 0) + 1} 章 · ${SUB_MODE_LABEL[t.subMode] || '选择题'}`;
  }
  return base;
}

// 跳转位置编辑器：返回 { node, read() }
function targetEditor(initial, onChange) {
  const t = { view: 'viewSubjects', subject: 'biology', chapterIdx: 0, subMode: 'mcq', ...(initial || {}) };
  const viewSel = el('select', { class: 'select', attrs: { 'aria-label': '跳转页面' } },
    Object.entries(VIEW_LABEL).map(([v, label]) => el('option', { value: v, text: label, selected: t.view === v })));
  const subjSel = el('select', { class: 'select', attrs: { 'aria-label': '科目' } },
    SUBJECTS.map(s => el('option', { value: s, text: `${SUBJECT_LABEL[s]}科`, selected: t.subject === s })));
  const chapSel = el('select', { class: 'select', attrs: { 'aria-label': '章节' } });
  const modeSel = el('select', { class: 'select', attrs: { 'aria-label': '分页' } },
    Object.entries(SUB_MODE_LABEL).map(([v, label]) => el('option', { value: v, text: label, selected: t.subMode === v })));
  const studyRow = el('div', { style: 'display:grid; grid-template-columns: 1fr 1.6fr 1fr; gap:8px;' }, subjSel, chapSel, modeSel);

  const fillChapters = () => {
    clear(chapSel);
    const secs = state.banks[subjSel.value] || [];
    secs.forEach((sec, i) => chapSel.appendChild(el('option', { value: i, text: sec.title, selected: i === Number(t.chapterIdx) })));
    if (!secs.length) chapSel.appendChild(el('option', { value: 0, text: '（无章节）' }));
  };
  const read = () => (viewSel.value === 'viewStudy'
    ? { view: 'viewStudy', subject: subjSel.value, chapterIdx: Number(chapSel.value) || 0, subMode: modeSel.value }
    : { view: viewSel.value });
  const sync = () => { studyRow.hidden = viewSel.value !== 'viewStudy'; if (onChange) onChange(read()); };

  fillChapters();
  viewSel.addEventListener('change', sync);
  subjSel.addEventListener('change', () => { t.chapterIdx = 0; fillChapters(); sync(); });
  chapSel.addEventListener('change', sync);
  modeSel.addEventListener('change', sync);
  studyRow.hidden = t.view !== 'viewStudy';

  return { node: el('div', { class: 'stack', style: 'gap:8px' }, viewSel, studyRow), read };
}

function spritePreview(summary) {
  const panel = el('div', { class: 'panel' }, '已解决 ', el('em', { text: `【${summary || '处理说明'}】` }), '，要查看吗？›');
  return el('div', { class: 'sprite-preview', attrs: { 'aria-label': '学生会看到的通知' } },
    panel, el('div', { class: 'line' }),
    // 学生打开面板时，小精灵正是这个「给你看」的姿势
    el('img', { class: 'char', attrs: { src: '/assets/sprite/present.webp', alt: '' } }));
}

function renderIssues(body, actions) {
  const pub = state.session.publishing || {};
  actions.appendChild(el('span', { class: `status ${pub.enabled ? 'status-good' : 'status-warning'}` },
    icon(pub.enabled ? 'checkCircle' : 'info'),
    el('span', { text: pub.enabled ? `一键发布已连接 ${pub.repo}` : '一键发布未配置（仍可复制 JSON 手动提交）' })));

  const steps = el('div', { class: 'steps' });
  body.appendChild(steps);

  // 步骤 1：贴处理码
  const codeInput = el('textarea', { class: 'textarea', attrs: { placeholder: '把 Formspree 邮件里的「开发者处理码」（UECFB: 开头）贴进来，整封邮件内容一起贴也可以。', 'aria-label': '开发者处理码' } });
  const parsedBox = el('div', {});
  const manualId = el('input', { class: 'input mono', attrs: { placeholder: 'fb_xxxxxxxx', 'aria-label': '手动输入问题编号' } });
  const manualRow = el('div', { class: 'field', hidden: true },
    el('label', { class: 'field-label', text: '问题编号' }), manualId,
    el('span', { class: 'field-hint', text: '学生在「网页问题申诉」页面能看到自己的问题编号。' }));

  const step1 = el('div', { class: 'card' },
    el('div', { class: 'step-head' }, el('span', { class: 'step-num', text: '1' }), el('span', { class: 'card-title', text: '贴上开发者处理码' })),
    el('div', { class: 'stack', style: 'gap:10px' },
      codeInput,
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '没有处理码？手动输入编号', onclick: () => { manualRow.hidden = !manualRow.hidden; if (!manualRow.hidden) manualId.focus(); } })),
      manualRow,
      parsedBox));
  steps.appendChild(step1);

  // 步骤 2 + 3：处理说明、跳转位置、发布
  const summaryInput = el('input', { class: 'input', attrs: { maxlength: 60, placeholder: '例：图片放大功能已修好', 'aria-label': '处理说明' } });
  const counter = el('span', { class: 'field-hint', text: '0 / 60' });
  const previewSlot = el('div', {}, spritePreview(''));
  let editor = targetEditor(null);
  const editorSlot = el('div', {}, editor.node);
  const publishBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: true }, icon('send'), el('span', { text: '发布到网站' }));
  const copyBtn = el('button', { class: 'btn', type: 'button', disabled: true }, icon('copy'), el('span', { text: '复制 JSON' }));

  const currentId = () => (state.parsedReport ? state.parsedReport.id : manualId.value.trim());
  const buildEntry = () => ({ reportId: currentId(), summary: summaryInput.value.trim(), target: editor.read() });
  const refreshButtons = () => {
    const valid = /^fb_[a-z0-9]{4,40}$/.test(currentId()) && summaryInput.value.trim().length > 0;
    publishBtn.disabled = !valid || !pub.enabled;
    copyBtn.disabled = !valid;
  };

  summaryInput.addEventListener('input', () => {
    counter.textContent = `${summaryInput.value.length} / 60`;
    clear(previewSlot).appendChild(spritePreview(summaryInput.value.trim()));
    refreshButtons();
  });
  manualId.addEventListener('input', () => { state.parsedReport = null; refreshButtons(); });

  const parse = () => {
    clear(parsedBox);
    const report = decodeDevCode(codeInput.value);
    state.parsedReport = report;
    if (!codeInput.value.trim()) { refreshButtons(); return; }
    if (!report) {
      parsedBox.appendChild(el('div', { class: 'form-error' }, icon('alert'), el('span', { text: '没有找到有效的处理码。请确认贴的内容里包含 UECFB: 开头的那一整串。' })));
      refreshButtons();
      return;
    }
    const already = state.resolutions.find(r => r.reportId === report.id);
    parsedBox.appendChild(el('dl', { class: 'kv' },
      el('dt', { text: '问题编号' }), el('dd', { class: 'mono', text: report.id }),
      el('dt', { text: '提交时间' }), el('dd', { text: report.createdAt ? new Date(report.createdAt).toLocaleString('zh-CN') : '—' }),
      el('dt', { text: '出问题处' }), el('dd', { text: describeTarget(report.location) }),
      el('dt', { text: '问题描述' }), el('dd', {}, el('div', { class: 'quote', text: report.message || '—' }))));
    if (already) {
      parsedBox.appendChild(el('div', { class: 'status status-warning', style: 'margin-top:10px' }, icon('info'),
        el('span', { text: `这个问题已发布过处理结果：「${already.summary}」。再次发布会覆盖。` })));
    }
    editor = targetEditor(report.location, refreshButtons);
    clear(editorSlot).appendChild(editor.node);
    refreshButtons();
    summaryInput.focus();
  };
  codeInput.addEventListener('input', parse);

  publishBtn.addEventListener('click', async () => {
    const entry = buildEntry();
    publishBtn.disabled = true;
    clear(publishBtn);
    appendChildren(publishBtn, [el('span', { class: 'spinner' }), '发布中…']);
    const { ok, status, data } = await api('/api/dev-resolutions', { method: 'POST', body: { action: 'publish', entry } });
    clear(publishBtn);
    appendChildren(publishBtn, [icon('send'), el('span', { text: '发布到网站' })]);
    if (handleUnauthenticated(status)) return;
    if (!ok) {
      toast(data.message || `发布失败（${status}）`, 'critical');
      refreshButtons();
      return;
    }
    state.resolutions = data.resolutions || state.resolutions;
    state.resolutionsSource = 'github';
    toast('已发布，Vercel 重新部署后（约 1 分钟）学生端生效', 'good', data.commit && data.commit.url ? { href: data.commit.url, text: '查看提交' } : null);
    codeInput.value = '';
    manualId.value = '';
    summaryInput.value = '';
    summaryInput.dispatchEvent(new Event('input'));
    state.parsedReport = null;
    clear(parsedBox);
    renderResolutionsTable(tableSlot);
  });

  copyBtn.addEventListener('click', async () => {
    const entry = { ...buildEntry(), resolvedAt: new Date().toISOString().slice(0, 10) };
    const text = JSON.stringify(entry, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制，贴进 data/resolved_issues.json 的 resolutions 数组即可', 'good');
    } catch (e) {
      window.prompt('请手动复制：', text);
    }
  });

  steps.appendChild(el('div', { class: 'card' },
    el('div', { class: 'step-head' }, el('span', { class: 'step-num', text: '2' }), el('span', { class: 'card-title', text: '写处理说明，确认跳转位置' })),
    el('div', { class: 'stack', style: 'gap:12px' },
      el('div', { class: 'field' },
        el('label', { class: 'field-label', text: '处理说明（会显示在学生的通知里）' }), summaryInput, counter),
      el('div', { class: 'field' },
        el('span', { class: 'field-label', text: '学生点「带我去看看」时跳到哪里' }), editorSlot),
      el('div', { class: 'field' }, el('span', { class: 'field-label', text: '学生会看到' }), previewSlot),
      el('div', { class: 'row', style: 'padding-top:4px; border-top:1px solid var(--border); padding-top:14px;' },
        el('span', { class: 'step-num', text: '3' }), publishBtn, copyBtn))));

  // 已发布列表
  const tableSlot = el('div', {});
  body.appendChild(el('div', { class: 'card' },
    el('div', { class: 'chart-head' },
      el('div', {},
        el('div', { class: 'card-title', text: '已发布的处理结果' }),
        el('div', { class: 'card-sub', text: state.resolutionsSource === 'github' ? '来自 GitHub（即时）' : '来自已部署的网站（发布后约 1 分钟才会更新）' })),
      el('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { await loadResolutions(); renderResolutionsTable(tableSlot); toast('已刷新', 'good'); } },
        icon('refresh'), el('span', { text: '刷新' }))),
    tableSlot));
  renderResolutionsTable(tableSlot);
}

function renderResolutionsTable(slot) {
  clear(slot);
  const pub = state.session.publishing || {};
  const list = state.resolutions.slice().reverse();
  if (!list.length) {
    slot.appendChild(el('div', { class: 'empty' }, icon('inbox'), el('div', { text: '还没有发布过任何处理结果。' })));
    return;
  }
  slot.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', { text: '问题编号' }), el('th', { text: '处理说明' }), el('th', { text: '跳转位置' }), el('th', { text: '日期' }), el('th', { text: '' }))),
    el('tbody', {}, list.map(r => el('tr', {},
      el('td', { class: 'mono', text: r.reportId }),
      el('td', { class: 'wrap', text: r.summary }),
      el('td', { text: describeTarget(r.target) }),
      el('td', { class: 'num', text: r.resolvedAt || '—' }),
      el('td', {}, pub.enabled ? el('button', {
        class: 'btn btn-sm btn-danger', type: 'button',
        onclick: async (e) => {
          const btn = e.currentTarget; // await 之后 currentTarget 会变成 null，先存起来
          if (!window.confirm(`确定撤回 ${r.reportId} 的处理结果？还没点「没问题了」的学生将不会再看到通知。`)) return;
          btn.disabled = true;
          const { ok, status, data } = await api('/api/dev-resolutions', { method: 'POST', body: { action: 'withdraw', reportId: r.reportId } });
          if (handleUnauthenticated(status)) return;
          if (!ok) { toast(data.message || '撤回失败', 'critical'); btn.disabled = false; return; }
          state.resolutions = data.resolutions || [];
          toast('已撤回', 'good');
          renderResolutionsTable(slot);
        },
      }, icon('undo'), el('span', { text: '撤回' })) : null)))))));
}

/* ==========================================================================
   题库巡检
   ========================================================================== */
function questionPreview(item, type, compact) {
  const box = el('div', { class: 'q-preview' });
  box.appendChild(el('div', { class: 'q', text: type === 'mcq' ? item.q : item.question }));
  if (typeof item.figure === 'string' && item.figure.trim().startsWith('<svg')) {
    const fig = el('div', { style: 'margin-top:8px' });
    fig.innerHTML = item.figure; // 题库里由管理员自己写的 SVG 配图，学生站也同样直接渲染
    box.appendChild(fig);
  }
  if (item.image && /^(\.?\/)?images\//.test(item.image)) {
    box.appendChild(el('img', { src: '/' + item.image.replace(/^\.?\//, ''), alt: '配图', style: 'margin-top:8px; max-width:100%; max-height:220px; border-radius:8px;' }));
  }
  if (type === 'mcq') {
    (item.options || []).forEach((opt, i) => box.appendChild(el('div', { class: `q-opt${i === item.answer ? ' correct' : ''}`, text: opt })));
    if (item.explanation && !compact) box.appendChild(el('div', { class: 'q-exp', text: item.explanation }));
  } else if (item.answer && !compact) {
    const tmp = document.createElement('div');
    tmp.innerHTML = item.answer;
    box.appendChild(el('div', { class: 'q-exp', text: tmp.textContent.trim() }));
  }
  return box;
}

function issueRow(issue) {
  const lvl = LEVEL[issue.level];
  const text = issue.type === 'mcq' ? issue.item.q : issue.item.question;
  const preview = el('div', { hidden: true });
  const toggle = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', attrs: { 'aria-expanded': 'false' }, text: '预览',
    onclick: () => {
      const open = preview.hidden;
      preview.hidden = !open;
      toggle.textContent = open ? '收起' : '预览';
      toggle.setAttribute('aria-expanded', String(open));
      if (open && !preview.firstChild) preview.appendChild(questionPreview(issue.item, issue.type));
    },
  });
  const [editBtn, editPanel] = editToggle(issue.subject, issue.chapterIdx, issue.type, issue.qIndex);
  return el('div', { class: 'issue' },
    el('div', { class: 'issue-top' },
      el('span', { class: `status ${lvl.cls}` }, icon(lvl.icon), el('span', { text: `${lvl.label}：${issue.label}` })),
      el('span', { class: 'pill', text: `${SUBJECT_LABEL[issue.subject]} · ${issue.chapterTitle}` }),
      el('span', { class: 'pill', text: `${issue.type === 'mcq' ? '选择题' : '做答题'} 第 ${issue.qIndex + 1} 题` }),
      el('span', { style: 'margin-left:auto' }, toggle, editBtn)),
    el('div', { class: 'issue-text', text: String(text || '（空）').replace(/\s+/g, ' ').slice(0, 120) }),
    preview, editPanel);
}

function renderInspector(body, actions) {
  actions.appendChild(el('button', {
    class: 'btn btn-sm', type: 'button',
    onclick: async () => { await loadData(); state.imageCheckDone = false; navigate(); toast('已重新读取题库', 'good'); },
  }, icon('refresh'), el('span', { text: '重新巡检' })));

  const filters = el('div', { class: 'row' });
  const seg = el('div', { class: 'segmented', attrs: { role: 'group', 'aria-label': '科目' } });
  [['all', '全部'], ...SUBJECTS.map(s => [s, SUBJECT_LABEL[s]])].forEach(([v, label]) => seg.appendChild(el('button', {
    type: 'button', text: label, attrs: { 'aria-pressed': String(state.inspectorSubject === v) },
    onclick: () => { state.inspectorSubject = v; navigate(); },
  })));
  const levelSel = el('select', { class: 'select', style: 'width:auto; height:36px; padding-top:0; padding-bottom:0;', attrs: { 'aria-label': '问题等级' },
    onchange: (e) => { state.inspectorLevel = e.target.value; navigate(); } },
  [['all', '全部等级'], ['critical', '严重'], ['serious', '待确认'], ['warning', '提醒']].map(([v, l]) => el('option', { value: v, text: l, selected: state.inspectorLevel === v })));
  appendChildren(filters, [seg, levelSel]);
  body.appendChild(filters);

  const all = state.issues.concat(state.imageIssues);
  const list = all.filter(i => (state.inspectorSubject === 'all' || i.subject === state.inspectorSubject)
    && (state.inspectorLevel === 'all' || i.level === state.inspectorLevel));

  const summary = el('div', { class: 'row' });
  Object.entries(LEVEL).forEach(([k, lvl]) => {
    const n = all.filter(i => (state.inspectorSubject === 'all' || i.subject === state.inspectorSubject) && i.level === k).length;
    summary.appendChild(el('span', { class: `pill status ${lvl.cls}` }, icon(lvl.icon), el('span', { text: `${lvl.label} ${n}` })));
  });
  summary.appendChild(el('span', { class: 'field-hint', attrs: { id: 'imgCheckNote' }, text: state.imageCheckDone ? '图片链接已检查' : '正在检查图片链接…' }));
  body.appendChild(summary);

  const card = el('div', { class: 'card list-card' });
  if (!list.length) {
    card.appendChild(el('div', { class: 'empty' }, icon('checkCircle'), el('div', { text: all.length ? '这个筛选条件下没有问题。' : '全部通过，没有发现问题。' })));
  } else {
    const order = { critical: 0, serious: 1, warning: 2 };
    list.sort((a, b) => order[a.level] - order[b.level]).forEach(i => card.appendChild(issueRow(i)));
  }
  body.appendChild(card);

  if (!state.imageCheckDone) {
    checkImageLinks().then(() => {
      if ((window.location.hash || '#overview') === '#inspector') navigate();
    });
  }
}

/* ==========================================================================
   编辑器（待审题与已上线的题共用）
   ========================================================================== */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// 手机拍的原图动辄好几 MB：先在浏览器缩到长边 1600px、转 WebP（不支援就 JPG），再上传
async function shrinkImage(file) {
  const url = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('读不了这个档案'));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('这个浏览器看不懂这张图的格式（iPhone 的 HEIC 请先转成 JPG）'));
    i.src = url;
  });
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';           // 透明底的 PNG 转成 JPG 时不要变黑底
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let out = canvas.toDataURL('image/webp', 0.85);
  if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.88);
  if ((out.length - out.indexOf(',') - 1) * 0.75 > MAX_IMAGE_BYTES) throw new Error('图片压缩後仍超过 2MB，请先裁小一点');
  return out;
}

// 回传 { node, patch(), image() }：patch 只含改过的栏位，image 是新上传的图（data URL）或 null
// 配图栏：预览、上传（先缩小）、移除。选择题与做答题共用
function imagePicker(item) {
  let newImage = null;
  let removeImage = false;
  const preview = el('div', { class: 'ed-image' });
  const showPreview = () => {
    clear(preview);
    const src = newImage || (!removeImage && item.image ? '/' + String(item.image).replace(/^\.?\//, '') : null);
    if (src) preview.appendChild(el('img', { src, alt: '配图预览' }));
    else preview.appendChild(el('span', { class: 'field-hint', text: item.figure && !removeImage ? '目前是手绘 SVG 配图；上传图片後学生站会改显示图片' : '没有配图' }));
  };
  const file = el('input', { type: 'file', hidden: true, attrs: { accept: 'image/*' } });
  const drop = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', hidden: !item.image,
    onclick: () => { newImage = null; removeImage = true; drop.hidden = true; showPreview(); },
  }, el('span', { text: '移除配图' }));
  const pick = el('button', { class: 'btn btn-sm', type: 'button', onclick: () => file.click() },
    icon('image'), el('span', { text: item.image ? '换一张图' : '上传配图' }));
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    try {
      newImage = await shrinkImage(f);
      removeImage = false;
      drop.hidden = false;
      showPreview();
    } catch (e) {
      toast(e.message, 'bad');
    }
  });
  showPreview();
  return {
    node: el('div', { class: 'stack', style: 'gap:8px' }, preview, el('div', { class: 'row' }, pick, drop, file)),
    image: () => newImage,
    // 按了「移除」而且没有换新图：送 image: '' 把题库里的配图拿掉
    removed: () => removeImage && !newImage && Boolean(item.image),
  };
}

// 回传 { node, patch(), image() }：patch 只含改过的栏位，image 是新上传的图（data URL）或 null
function questionEditor(item, isSubj) {
  const box = el('div', { class: 'editor' });
  const area = (value, rows) => el('textarea', { class: 'textarea', value: value || '', rows });
  const field = (label, control) => el('div', { class: 'field' }, el('span', { class: 'field-label', text: label }), control);
  const changed = values => Object.fromEntries(Object.entries(values)
    .filter(([k, v]) => v !== String(item[k] == null ? '' : item[k]).trim()));
  const img = imagePicker(item);

  if (isSubj) {
    const q = area(item.question, 5);
    const a = area(item.answer, 6);
    appendChildren(box, [field('题干', q), field('配图', img.node), field('参考答案（学生站照 HTML 显示，<br> 是换行）', a)]);
    return {
      node: box,
      image: img.image,
      patch: () => {
        const p = changed({ question: q.value.trim(), answer: a.value.trim() });
        if (img.removed()) p.image = '';
        return p;
      },
    };
  }

  const q = area(item.q, 3);
  const name = `ans-${Math.random().toString(36).slice(2)}`;
  const opts = [0, 1, 2, 3].map(i => el('input', { class: 'input', value: (item.options || [])[i] || '' }));
  const radios = opts.map((_, i) => el('input', { type: 'radio', name, checked: item.answer === i, attrs: { 'aria-label': `正确答案是 ${'ABCD'[i]}` } }));
  const exp = area(item.explanation, 3);

  appendChildren(box, [
    field('题干', q),
    field('配图', img.node),
    field('选项（圈选的是正确答案）', el('div', { class: 'stack', style: 'gap:6px' },
      opts.map((o, i) => el('div', { class: 'ed-opt' }, radios[i], o)))),
    field('考点解析', exp),
  ]);
  return {
    node: box,
    image: img.image,
    patch: () => {
      const p = changed({ q: q.value.trim(), explanation: exp.value.trim() });
      const options = opts.map(o => o.value.trim());
      if (options.some((o, i) => o !== String((item.options || [])[i] || '').trim())) p.options = options;
      const answer = radios.findIndex(r => r.checked);
      if (answer >= 0 && answer !== item.answer) p.answer = answer;
      if (img.removed()) p.image = '';
      return p;
    },
  };
}

// 按钮转圈、呼叫接口、处理错误；成功回传 data，失败回传 null
async function busy(btn, call) {
  const kids = [...btn.childNodes];
  btn.disabled = true;
  btn.textContent = '处理中…';
  const { ok, status, data } = await call();
  btn.disabled = false;
  btn.replaceChildren(...kids);
  if (handleUnauthenticated(status)) return null;
  if (!ok) {
    toast(data.message || '处理失败', 'bad');
    return null;
  }
  return data;
}

// 重画目前页面但留在原本捲动的位置
function rerender() {
  const y = window.scrollY;
  navigate();
  window.scrollTo(0, y);
}

const NO_PUBLISH_HINT = '尚未配置 GITHUB_TOKEN：可以看，但不能存档或采纳。';

// 已上线题目的「编辑」按钮与展开的编辑面板
function editToggle(subject, chapterIdx, type, qIndex) {
  const panel = el('div', { hidden: true });
  const btn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', attrs: { 'aria-expanded': 'false' } }, icon('edit'), el('span', { text: '编辑' }));
  btn.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open && !panel.firstChild) panel.appendChild(bankEditPanel(subject, chapterIdx, type, qIndex));
  });
  return [btn, panel];
}

function bankEditPanel(subject, chapterIdx, type, qIndex) {
  const sec = state.banks[subject][chapterIdx];
  const list = type === 'mcq' ? sec.mcqs : sec.subjectives;
  const item = list[qIndex];
  const ed = questionEditor(item, type !== 'mcq');
  const save = el('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !canPublish() }, icon('check'), el('span', { text: '存档并上线' }));
  save.addEventListener('click', async () => {
    const patch = ed.patch();
    const image = ed.image();
    if (!Object.keys(patch).length && !image) return toast('没有改动', 'bad');
    const data = await busy(save, () => api('/api/dev-edit', {
      method: 'POST',
      body: { target: 'bank', subject, chapterId: sec.id, type: type === 'mcq' ? 'mcq' : 'subjective', index: qIndex, expect: item.q || item.question, patch, image },
    }));
    if (!data) return;
    list[qIndex] = data.item;
    state.issues = inspectBanks();
    updateNavCounts();
    toast('已存档，约一分钟後学生就看得到', 'good');
    rerender();
  });
  // 全班共用的 AI 讲解讲错了：清掉，下一个问的学生会拿到重新讲的。改过题目内容的话旧讲解本来就会作废
  let clearBtn = null;
  if (type === 'mcq') {
    clearBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: !canPublish() }, icon('trash'), el('span', { text: '清除 AI 讲解' }));
    clearBtn.addEventListener('click', async () => {
      if (!confirm('清掉这一题四个选项的 AI 讲解？\n\n下一个按「AI 讲给我听」的学生会拿到重新讲的版本。已经看过的学生，装置上存的那份不会变。')) return;
      const data = await busy(clearBtn, () => api('/api/dev-edit', {
        method: 'POST',
        body: { target: 'bank', action: 'clearExplain', subject, chapterId: sec.id, type: 'mcq', index: qIndex, expect: item.q },
      }));
      if (data) toast(data.cleared ? `已清除 ${data.cleared} 份讲解` : '这一题还没有人问过 AI 讲解', 'good');
    });
  }
  return el('div', { class: 'ed-panel' }, ed.node,
    el('div', { class: 'row' }, save, clearBtn, canPublish() ? null : el('span', { class: 'field-hint', text: NO_PUBLISH_HINT })));
}

/* ==========================================================================
   题目修改（搜寻已上线的题）
   ========================================================================== */
// 找题：有关键字就搜；没有关键字时，选了科目与章节就列出整章；勾「只看已下架」列出下架的题
function findBankItems() {
  const q = state.editorQuery.replace(/\s+/g, '').toLowerCase();
  const browsing = !q && state.editorSubject !== 'all' && state.editorChapter;
  if (!q && !browsing && !state.editorHiddenOnly) return null;
  const hits = [];
  SUBJECTS.filter(s => state.editorSubject === 'all' || s === state.editorSubject).forEach(s => {
    state.banks[s].forEach((sec, chapterIdx) => {
      if (state.editorSubject !== 'all' && state.editorChapter && sec.id !== state.editorChapter) return;
      [['mcq', sec.mcqs || []], ['subj', sec.subjectives || []]].forEach(([type, list]) => {
        list.forEach((item, qIndex) => {
          if (state.editorHiddenOnly && !item.hidden) return;
          if (q) {
            const hay = [item.q, item.question, ...(item.options || [])].join(' ').replace(/\s+/g, '').toLowerCase();
            if (!hay.includes(q)) return;
          }
          hits.push({ subject: s, chapterIdx, chapterTitle: sec.title, type, qIndex, item });
        });
      });
    });
  });
  return hits;
}

// 下架／恢复：题目留在题库原位（加 hidden），学生端不显示。
// 不真的删掉：学生的进度、错题、笔记都按「第几题」记，删掉一题，後面每一题的纪录都会对到别题
async function setHidden(btn, h, hide) {
  if (hide && !confirm('下架这一题？\n\n学生会马上看不到它（约一分钟後部署完成），错题本、今日复习、题目档也会一起拿掉。\n题目会留在题库里，随时可以在这里按「恢复」。')) return;
  const data = await busy(btn, () => api('/api/dev-edit', {
    method: 'POST',
    body: {
      target: 'bank', action: hide ? 'hide' : 'unhide', subject: h.subject, chapterId: state.banks[h.subject][h.chapterIdx].id,
      type: h.type === 'mcq' ? 'mcq' : 'subjective', index: h.qIndex, expect: h.item.q || h.item.question,
    },
  }));
  if (!data) return;
  const sec = state.banks[h.subject][h.chapterIdx];
  (h.type === 'mcq' ? sec.mcqs : sec.subjectives)[h.qIndex] = data.item;
  state.issues = inspectBanks();
  updateNavCounts();
  toast(hide ? '已下架，约一分钟後学生就看不到了' : '已恢复，约一分钟後学生就看得到', 'good');
  rerender();
}

function renderEditor(body) {
  if (!canPublish()) body.appendChild(el('div', { class: 'card field-hint', text: NO_PUBLISH_HINT }));

  const seg = el('div', { class: 'segmented', attrs: { role: 'group', 'aria-label': '科目' } });
  [['all', '全部'], ...SUBJECTS.map(s => [s, SUBJECT_LABEL[s]])].forEach(([v, label]) => seg.appendChild(el('button', {
    type: 'button', text: label, attrs: { 'aria-pressed': String(state.editorSubject === v) },
    onclick: () => { state.editorSubject = v; state.editorChapter = ''; navigate(); },
  })));
  const input = el('input', {
    class: 'input', type: 'search', value: state.editorQuery,
    placeholder: '输入题干或选项里的几个字，例如「甘油」', attrs: { 'aria-label': '搜寻题目' },
  });

  // 章节：先选一科才有得选；选了就不必打关键字，整章列出来
  const chapter = el('select', { class: 'select select-inline', attrs: { 'aria-label': '章节' }, disabled: state.editorSubject === 'all' });
  chapter.appendChild(el('option', { text: state.editorSubject === 'all' ? '先选一科，再选章节' : '全部章节', attrs: { value: '' } }));
  if (state.editorSubject !== 'all') {
    state.banks[state.editorSubject].forEach(sec => {
      const n = (sec.mcqs || []).length + (sec.subjectives || []).length;
      const opt = el('option', { text: `${sec.title || sec.id}（${n} 题）`, attrs: { value: sec.id } });
      if (sec.id === state.editorChapter) opt.selected = true;
      chapter.appendChild(opt);
    });
  }
  chapter.addEventListener('change', () => { state.editorChapter = chapter.value; draw(); });
  const hiddenOnly = el('input', { type: 'checkbox', checked: state.editorHiddenOnly });
  hiddenOnly.addEventListener('change', () => { state.editorHiddenOnly = hiddenOnly.checked; draw(); });

  body.appendChild(el('div', { class: 'row' }, el('div', { style: 'flex:1; min-width:220px' }, input), seg));
  body.appendChild(el('div', { class: 'row' }, chapter,
    el('label', { class: 'field-hint', style: 'display:inline-flex; align-items:center; gap:6px; cursor:pointer' }, hiddenOnly, '只看已下架的题')));

  const results = el('div', { class: 'card list-card' });
  body.appendChild(results);
  const draw = () => {
    clear(results);
    const hits = findBankItems();
    if (!hits || !hits.length) {
      results.appendChild(el('div', { class: 'empty' }, icon('search'),
        el('div', { text: !hits ? '输入关键字搜寻，或选一科、再选章节，整章列出来。'
          : state.editorHiddenOnly ? '没有已下架的题。' : '找不到符合的题目。' })));
      return;
    }
    const LIMIT = 60;
    hits.slice(0, LIMIT).forEach(h => {
      const [editBtn, panel] = editToggle(h.subject, h.chapterIdx, h.type, h.qIndex);
      const hidden = Boolean(h.item.hidden);
      const toggle = el('button', { class: `btn btn-sm${hidden ? '' : ' btn-ghost'}`, type: 'button', disabled: !canPublish() },
        icon(hidden ? 'undo' : 'eyeOff'), el('span', { text: hidden ? '恢复' : '下架' }));
      toggle.addEventListener('click', () => setHidden(toggle, h, !hidden));
      const text = h.type === 'mcq' ? h.item.q : h.item.question;
      results.appendChild(el('div', { class: `issue${hidden ? ' is-retired' : ''}` },
        el('div', { class: 'issue-top' },
          el('span', { class: 'pill', text: `${SUBJECT_LABEL[h.subject]} · ${h.chapterTitle}` }),
          el('span', { class: 'pill', text: `${h.type === 'mcq' ? '选择题' : '做答题'} 第 ${h.qIndex + 1} 题` }),
          hidden ? el('span', { class: 'pill pill-retired' }, icon('eyeOff'), el('span', { text: '已下架' })) : null,
          el('span', { style: 'margin-left:auto; display:inline-flex; gap:6px' }, editBtn, toggle)),
        el('div', { class: 'issue-text', text: String(text || '（空）').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 160) }),
        panel));
    });
    if (hits.length > LIMIT) results.appendChild(el('div', { class: 'issue field-hint', text: `还有 ${hits.length - LIMIT} 题没列出，多打几个字或选章节缩小范围。` }));
  };
  input.addEventListener('input', () => { state.editorQuery = input.value; draw(); });
  draw();
  if (state.editorQuery) input.focus();
}

/* ==========================================================================
   AI 录题待审
   ========================================================================== */
// 要逐题看的理由：流水线标的 flags、文字检查（已跑过的会重复，去掉）、章节没判断出来
function pendingProblems(item) {
  const reasons = [...(item.flags || []), ...textLint(item)];
  if (!(state.banks[item.subject] || []).some(sec => sec.id === item.chapter_id)) reasons.push('AI 没能判断章节，请指定');
  return [...new Set(reasons)];
}

// 章节下拉：AI 归类不一定准，采纳当下顺手改掉比事後回头改容易
function chapterPicker(item) {
  const sections = state.banks[item.subject] || [];
  const picker = el('select', { class: 'select select-inline', attrs: { 'aria-label': '归入章节' } });
  if (!sections.length) {
    picker.appendChild(el('option', { text: '（这一科还没有章节框架）', attrs: { value: '' } }));
    picker.disabled = true;
    return picker;
  }
  sections.forEach(sec => {
    const opt = el('option', { text: sec.title || sec.id, attrs: { value: sec.id } });
    if (sec.id === item.chapter_id) opt.selected = true;
    picker.appendChild(opt);
  });
  if (!sections.some(sec => sec.id === item.chapter_id)) {
    const hint = el('option', { text: '⚠️ 未分类 —— 请指定章节', attrs: { value: '' } });
    hint.selected = true;
    picker.insertBefore(hint, picker.firstChild);
  }
  return picker;
}

function originPills(item) {
  return [
    el('span', { class: 'pill', text: SUBJECT_LABEL[item.subject] || item.subject || '未知科目' }),
    el('span', { class: 'pill', text: item.type === 'subjective' ? '做答题' : '选择题' }),
    el('span', { class: 'pill', text: item.origin === 'ai_generated' ? '🤖 AI 出题' : '📄 档案录入' }),
    item.type !== 'subjective' && item.answer_source === 'marked' ? el('span', { class: 'pill', text: '答案：原档标的' }) : null,
    item.type !== 'subjective' && item.answer_source === 'ai' ? el('span', { class: 'pill', text: '答案：AI 作答' }) : null,
  ];
}

function rejectButton(item) {
  const reject = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: !canPublish() }, el('span', { text: '退回' }));
  reject.addEventListener('click', async () => {
    if (!confirm('退回之後这一题会从待审区移除，且不会进题库。确定吗？')) return;
    await sendApproval(reject, { action: 'reject', ids: [item.id] });
  });
  return reject;
}

function problemCard(item, reasons) {
  const ed = questionEditor(item, item.type === 'subjective');
  const picker = chapterPicker(item);
  const adopt = el('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !canPublish() }, icon('check'), el('span', { text: '采纳（连同修改）' }));
  const save = el('button', { class: 'btn btn-sm', type: 'button', disabled: !canPublish() }, el('span', { text: '只存修改' }));

  adopt.addEventListener('click', async () => {
    if (!picker.value) return toast('请先指定章节', 'bad');
    await sendApproval(adopt, { action: 'adopt', items: [{ id: item.id, chapterId: picker.value, patch: ed.patch(), image: ed.image() }] });
  });
  save.addEventListener('click', async () => {
    const patch = ed.patch();
    const image = ed.image();
    if (!Object.keys(patch).length && !image) return toast('没有改动', 'bad');
    const data = await busy(save, () => api('/api/dev-edit', { method: 'POST', body: { target: 'pending', id: item.id, patch, image } }));
    if (!data) return;
    toast('已存到待审区，还没上线', 'good');
    await loadData();
    rerender();
  });

  return el('div', { class: 'issue' },
    el('div', { class: 'issue-top' }, originPills(item)),
    el('div', { class: 'stack', style: 'gap:4px' },
      reasons.map(f => el('span', { class: 'status status-serious' }, icon('warning'), el('span', { text: f })))),
    ed.node,
    el('div', { class: 'row' }, el('span', { class: 'field-hint', text: '归入章节：' }), picker, adopt, save, rejectButton(item)),
    el('div', { class: 'field-hint mono', text: `${item.source_draft || item.id} · ${item.ingested_at || item.generated_at || '—'}` }));
}

function cleanList(items) {
  const rows = items.map(item => {
    const check = el('input', { type: 'checkbox', checked: true, attrs: { 'aria-label': '勾选采纳' } });
    const picker = chapterPicker(item);
    const panel = el('div', { class: 'ed-panel', hidden: true });
    const row = { item, check, picker, ed: null };
    const toggle = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', attrs: { 'aria-expanded': 'false' } }, icon('edit'), el('span', { text: '编辑' }));
    toggle.addEventListener('click', () => {
      if (!row.ed) {
        row.ed = questionEditor(item, item.type === 'subjective');
        appendChildren(panel, [row.ed.node, el('div', { class: 'row' },
          el('span', { class: 'field-hint', text: '改好後照样勾选、一起采纳；不要这题就' }), rejectButton(item))]);
      }
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
    });
    row.node = el('div', { class: 'issue' },
      el('div', { class: 'clean-row' }, check,
        el('div', { class: 'clean-main' }, questionPreview(item, item.type === 'subjective' ? 'subj' : 'mcq', true)),
        toggle),
      el('div', { class: 'row' }, originPills(item), picker),
      panel);
    return row;
  });

  const go = el('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !canPublish() }, icon('check'), el('span', {}));
  const label = () => { go.lastChild.textContent = `采纳勾选的 ${rows.filter(r => r.check.checked).length} 题`; };
  rows.forEach(r => r.check.addEventListener('change', label));
  label();
  go.addEventListener('click', async () => {
    const picked = rows.filter(r => r.check.checked);
    if (!picked.length) return toast('没有勾选任何题', 'bad');
    if (picked.some(r => !r.picker.value)) return toast('有勾选的题还没指定章节', 'bad');
    if (!confirm(`把 ${picked.length} 题采纳进正式题库？学生马上就看得到。`)) return;
    await sendApproval(go, {
      action: 'adopt',
      items: picked.map(r => ({
        id: r.item.id, chapterId: r.picker.value,
        patch: r.ed ? r.ed.patch() : undefined, image: r.ed ? r.ed.image() : undefined,
      })),
    });
  });

  return el('div', { class: 'card list-card' },
    el('div', { class: 'issue' },
      el('div', { class: 'card-title', text: `没被标出问题的 ${items.length} 题` }),
      el('div', { class: 'card-sub', text: 'AI 自动检查（格式、和原档逐字比对、不看答案重做一次）都通过。检查抓不到所有错误 —— 请扫过题干与绿色答案，有疑问的取消勾选或按「编辑」。' }),
      el('div', { class: 'row', style: 'margin-top:8px' }, go)),
    rows.map(r => r.node));
}

function renderPending(body, actions) {
  actions.appendChild(el('a', { class: 'btn btn-sm', attrs: { href: `${REPO_URL}/actions`, target: '_blank', rel: 'noopener' } },
    icon('github'), el('span', { text: '录题／出题报告' })));

  if (!state.pending.length) {
    body.appendChild(el('div', { class: 'card' }, el('div', { class: 'empty' }, icon('sparkles'),
      el('div', { text: '目前没有待审核的题目。' }),
      el('div', { class: 'field-hint', style: 'margin-top:6px', text: '把题目档（照片、PDF、Word、PowerPoint、纯文字都可以）放进 drafts/biology、drafts/chemistry 或 drafts/physics 并推送；或到 Actions 手动跑「AI 依考纲出题」。' }))));
    return;
  }

  const problems = [];
  const clean = [];
  state.pending.forEach(item => {
    const reasons = pendingProblems(item);
    if (reasons.length) problems.push({ item, reasons });
    else clean.push(item);
  });
  // 答案有疑、和原档不一致（⚠️ 开头）的排最前面，先处理最可能出错的
  const doubtful = r => r.reasons.some(f => f.startsWith('⚠️'));
  problems.sort((a, b) => doubtful(b) - doubtful(a));

  body.appendChild(el('div', { class: 'card' },
    el('div', { class: 'field-hint' },
      el('strong', { text: `待审 ${state.pending.length} 题：` }),
      `${problems.length} 题被标出问题要逐题看，${clean.length} 题没问题可一键采纳。`,
      canPublish() ? ' 采纳会把题目直接写进正式题库并自动部署；退回只是从待审区移除。' : ` ${NO_PUBLISH_HINT}`)));

  if (problems.length) {
    body.appendChild(el('div', { class: 'card list-card' },
      el('div', { class: 'issue' }, el('div', { class: 'card-title', text: `要处理的 ${problems.length} 题` }),
        el('div', { class: 'card-sub', text: '直接在下面改文字、换配图，改好按「采纳」一次写进题库。' })),
      problems.map(p => problemCard(p.item, p.reasons))));
  }
  if (clean.length) body.appendChild(cleanList(clean));
}

async function sendApproval(btn, payload) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '处理中…';
  const { ok, data } = await api('/api/dev-approve', { method: 'POST', body: payload });
  btn.disabled = false;
  btn.textContent = label;

  if (!ok) return toast(data.message || '处理失败', 'bad');

  (data.skipped || []).forEach(s => toast(`${s.id}：${s.why}`, 'bad'));
  if (data.handled) {
    toast(payload.action === 'adopt'
      ? `已采纳 ${data.handled} 题，正在自动部署，稍後学生就看得到`
      : `已退回 ${data.handled} 题`, 'good');
    // 重新载入题库与待审区，画面上的数字才会跟著变
    await loadData();
    navigate();
  }
}

/* ==========================================================================
   本机调试
   ========================================================================== */
const STORAGE_KEYS = [
  { key: 'UEC_NOTES_v1', label: '笔记', describe: v => `${Object.keys(v || {}).length} 则笔记` },
  { key: 'UEC_PROGRESS_v1', label: '做题进度', describe: v => {
    let mastered = 0, wrong = 0;
    Object.values(v || {}).forEach(subj => Object.values(subj).forEach(ch => Object.values(ch).forEach(s => { if (s === 'mastered') mastered++; else if (s === 'wrong') wrong++; })));
    return `已掌握 ${mastered} 题 · 错题 ${wrong} 题`;
  } },
  { key: 'UEC_FEEDBACK_v1', label: '申诉记录', describe: v => {
    const r = (v && v.reports) || [];
    return `${r.length} 条 · 已解决 ${r.filter(x => x.status === 'resolved').length} 条`;
  } },
  { key: 'UEC_LAST_VISIT_v1', label: '继续学习', describe: v => (v && v.subject ? `${SUBJECT_LABEL[v.subject] || v.subject} · ${v.chapterTitle || ''}` : '—') },
  { key: 'UEC_BIO_HL_STORE_OFFICIAL_19', label: '荧光笔标记', describe: () => 'HTML 快照', raw: true },
];

function readStorage(key, raw) {
  try {
    const s = localStorage.getItem(key);
    if (s == null) return { exists: false, size: 0, value: null, text: '' };
    let value = s;
    if (!raw) { try { value = JSON.parse(s); } catch (e) { value = s; } }
    return { exists: true, size: new Blob([s]).size, value, text: s };
  } catch (e) {
    return { exists: false, size: 0, value: null, text: '' };
  }
}

function formatSize(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function renderLocal(body) {
  body.appendChild(el('div', { class: 'status status-warning' }, icon('info'),
    el('span', { text: '这里只是「这台设备、这个浏览器」里的数据，不会影响其他学生。' })));

  const grid = el('div', { class: 'storage-grid' });
  body.appendChild(grid);
  renderStorageGrid(grid);
  renderSpriteTester(body, () => renderStorageGrid(grid));
}

function renderStorageGrid(grid) {
  clear(grid);
  STORAGE_KEYS.forEach(def => {
    const data = readStorage(def.key, def.raw);
    const jsonBox = el('pre', { class: 'json-view', hidden: true });
    const card = el('div', { class: 'card spotlight' },
      el('div', { class: 'card-title', text: def.label }),
      el('div', { class: 'card-sub mono', text: def.key }),
      el('div', { class: 'stat-foot', style: 'margin-top:10px; color:var(--ink-2)', text: data.exists ? def.describe(data.value) : '（没有数据）' }),
      el('div', { class: 'field-hint', text: data.exists ? formatSize(data.size) : '' }),
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('button', { class: 'btn btn-sm', type: 'button', disabled: !data.exists,
          onclick: () => { jsonBox.hidden = !jsonBox.hidden; if (!jsonBox.hidden) jsonBox.textContent = def.raw ? data.text : JSON.stringify(data.value, null, 2); } },
        icon('code'), el('span', { text: '查看' })),
        el('button', { class: 'btn btn-sm', type: 'button', disabled: !data.exists,
          onclick: () => {
            const blob = new Blob([data.text], { type: 'application/json' });
            const a = el('a', { href: URL.createObjectURL(blob), download: `${def.key}.json` });
            document.body.appendChild(a); a.click(); a.remove();
          } },
        icon('download'), el('span', { text: '导出' })),
        el('button', { class: 'btn btn-sm btn-danger', type: 'button', disabled: !data.exists,
          onclick: () => {
            const synced = Boolean((readStorage('UEC_SYNC_v1').value || {}).code);
            // 笔记与申诉有删除纪录，清掉之後同步也不会带回来；其他资料同步时会从云端合并回来
            const tomb = def.key === 'UEC_NOTES_v1' || def.key === 'UEC_FEEDBACK_v1';
            if (!window.confirm(`确定清除「${def.label}」？此操作无法恢复。`
              + (synced && !tomb ? '\n\n这台装置连了同步码：下次同步时，云端的资料会合并回来。要真的清空，请先在学生网站的「同步」里断开。' : ''))) return;
            if (def.key === 'UEC_NOTES_v1') {
              const del = readStorage('UEC_NOTES_DELETED_v1').value || {};
              Object.keys(data.value || {}).forEach(id => { del[id] = Date.now(); });
              localStorage.setItem('UEC_NOTES_DELETED_v1', JSON.stringify(del));
              localStorage.removeItem(def.key);
            } else if (def.key === 'UEC_FEEDBACK_v1') {
              const old = data.value || {};
              const deleted = Object.assign({}, old.deleted, Object.fromEntries((old.reports || []).map(r => [r.id, Date.now()])));
              localStorage.setItem(def.key, JSON.stringify({ reports: [], deleted }));
            } else {
              localStorage.removeItem(def.key);
            }
            toast(`已清除${def.label}`, 'good');
            renderStorageGrid(grid);
          } },
        icon('trash'), el('span', { text: '清除' }))),
      jsonBox);
    grid.appendChild(card);
  });
}

function renderSpriteTester(body, onStorageChange) {
  const summaryInput = el('input', { class: 'input', attrs: { maxlength: 60, value: '这是一条测试通知', 'aria-label': '测试通知说明' } });
  summaryInput.value = '这是一条测试通知';
  const previewSlot = el('div', {}, spritePreview(summaryInput.value));
  summaryInput.addEventListener('input', () => clear(previewSlot).appendChild(spritePreview(summaryInput.value.trim())));
  const editor = targetEditor({ view: 'viewStudy', subject: 'biology', chapterIdx: 0, subMode: 'mcq' });

  body.appendChild(el('div', { class: 'card' },
    el('div', { class: 'card-title', text: '预览通知小精灵' }),
    el('div', { class: 'card-sub', text: '在本机生成一条「已解决」的测试申诉，打开学生网站就能看到小精灵，并测试「带我去看看」「没问题了」等互动。' }),
    el('div', { class: 'steps', style: 'margin-top:14px' },
      el('div', { class: 'stack', style: 'gap:12px' },
        el('div', { class: 'field' }, el('label', { class: 'field-label', text: '通知说明' }), summaryInput),
        el('div', { class: 'field' }, el('span', { class: 'field-label', text: '跳转位置' }), editor.node)),
      el('div', { class: 'stack', style: 'gap:12px' },
        previewSlot,
        el('div', { class: 'row' },
          el('button', { class: 'btn btn-primary', type: 'button',
            onclick: () => {
              const store = readStorage('UEC_FEEDBACK_v1').value;
              const data = store && Array.isArray(store.reports) ? store : { reports: [] };
              const loc = editor.read();
              data.reports.unshift({
                id: 'fb_devtest' + Math.random().toString(36).slice(2, 8),
                text: '（开发者测试通知）',
                contact: '',
                location: loc,
                createdAt: Date.now(),
                status: 'resolved',
                reply: { summary: summaryInput.value.trim() || '测试通知', resolvedAt: new Date().toISOString().slice(0, 10), target: loc },
                acknowledged: false,
                sent: true,
              });
              localStorage.setItem('UEC_FEEDBACK_v1', JSON.stringify(data));
              onStorageChange();
              toast('已生成测试通知', 'good', { href: '/', text: '打开学生网站' });
            } },
          icon('sparkles'), el('span', { text: '生成测试通知' })),
          el('button', { class: 'btn', type: 'button',
            onclick: () => {
              const store = readStorage('UEC_FEEDBACK_v1').value;
              if (!store || !Array.isArray(store.reports)) return;
              const before = store.reports.length;
              const gone = store.reports.filter(r => String(r.id).startsWith('fb_devtest')).map(r => r.id);
              store.reports = store.reports.filter(r => !gone.includes(r.id));
              // 留删除纪录：这台装置连了同步码的话，不留的话下次同步会从云端把它们带回来
              store.deleted = Object.assign({}, store.deleted, Object.fromEntries(gone.map(id => [id, Date.now()])));
              localStorage.setItem('UEC_FEEDBACK_v1', JSON.stringify(store));
              onStorageChange();
              toast(`已清除 ${before - store.reports.length} 条测试通知`, 'good');
            } },
          icon('trash'), el('span', { text: '清除测试通知' })))))));
}

document.getElementById('main').setAttribute('tabindex', '-1');
boot();
