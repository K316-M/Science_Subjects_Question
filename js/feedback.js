/* ==========================================================================
   网页问题申诉模块
   ---------------------------------------------------------------------------
   申诉的往返流程：
     1. 用户提交问题 → 存进他自己浏览器的 localStorage，拿到问题编号，
        同时通过 Formspree 自动寄到管理员邮箱（邮件里附带一行「开发者处理码」）
     2. 管理员登录开发者工作台（/dev/），贴上处理码、写处理说明、一键发布，
        结果会写进仓库的 data/resolved_issues.json
     3. 用户下次打开网站 → 比对本地的待处理问题 → 命中就弹出通知小精灵
   ========================================================================== */

const FEEDBACK_ENDPOINT = 'https://formspree.io/f/mdekopgq';
const FEEDBACK_STORAGE_KEY = 'UEC_FEEDBACK_v1';
const RESOLUTIONS_URL = '/data/resolved_issues.json';

const VIEW_LABELS = {
  viewSubjects: '主页（学科选择）',
  viewStudy: '做题页',
  viewNotes: '笔记页',
  viewArchive: '题目档页',
  viewFeedback: '网页问题申诉页',
};

let lastContentContext = { view: 'viewSubjects', subject: null, chapterIdx: 0, subMode: 'mcq' };

function loadFeedbackStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(FEEDBACK_STORAGE_KEY));
    if (raw && Array.isArray(raw.reports)) return raw;
  } catch (e) {}
  return { reports: [] };
}

function saveFeedbackStore(store) {
  try {
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    alert('保存失败：浏览器本地存储空间已满。');
  }
}

function makeReportId() {
  return 'fb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function rememberContentContext() {
  const activeView = document.querySelector('.view.active');
  if (!activeView) return;
  const view = activeView.id;
  if (view === 'viewFeedback') return; // 申诉页本身不算"出问题的位置"
  lastContentContext = {
    view,
    subject: typeof currentSubject !== 'undefined' ? currentSubject : null,
    chapterIdx: typeof activeChapterIdx !== 'undefined' ? activeChapterIdx : 0,
    subMode: typeof activeSubMode !== 'undefined' ? activeSubMode : 'mcq',
  };
}

function describeContext(ctx) {
  if (!ctx) return '未指定';
  const base = VIEW_LABELS[ctx.view] || ctx.view;
  if (ctx.view === 'viewStudy' && ctx.subject) {
    const label = (typeof SUBJECT_LABELS !== 'undefined' && SUBJECT_LABELS[ctx.subject]) || ctx.subject;
    return `${label} · ${base}（第 ${(ctx.chapterIdx || 0) + 1} 章）`;
  }
  return base;
}

/* ---------- 开发者处理码：编号 + 位置 + 描述打包成一行，工作台贴上即可解析 ---------- */
function makeDevCode(report) {
  const json = JSON.stringify({ i: report.id, l: report.location, m: report.text.slice(0, 200), t: report.createdAt });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return 'UECFB:' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function looksLikeEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str || '');
}

async function sendReportToAdmin(report) {
  if (!FEEDBACK_ENDPOINT) return false;
  const payload = {
    _subject: `独中理科网站问题申诉 ${report.id}`,
    问题编号: report.id,
    出问题的位置: describeContext(report.location),
    问题描述: report.text,
    联络方式: report.contact || '（未填写）',
    开发者处理码: makeDevCode(report),
  };
  // Formspree 会把 email 字段设为回复地址，格式不合法会整笔拒收，所以只在像邮箱时才带
  if (looksLikeEmail(report.contact)) payload.email = report.contact;

  try {
    const res = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function markReportSent(id, sent) {
  const store = loadFeedbackStore();
  const report = store.reports.find(r => r.id === id);
  if (report) {
    report.sent = sent;
    saveFeedbackStore(store);
  }
}

/* ---------- 申诉页 ---------- */
function renderFeedbackView() {
  const locSel = document.getElementById('fbLocation');
  if (locSel) {
    const opts = [
      { v: 'auto', t: `🎯 我刚才所在的位置：${describeContext(lastContentContext)}` },
      { v: 'viewSubjects', t: '主页（学科选择）' },
      { v: 'study:biology', t: '生物科 · 做题页' },
      { v: 'study:chemistry', t: '化学科 · 做题页' },
      { v: 'study:physics', t: '物理科 · 做题页' },
      { v: 'viewNotes', t: '笔记页' },
      { v: 'viewArchive', t: '题目档（下载）页' },
      { v: 'other', t: '其他／整个网站' },
    ];
    locSel.innerHTML = opts.map(o => `<option value="${o.v}">${escapeFb(o.t)}</option>`).join('');
  }
  renderMyReports();
}

function resolveSelectedLocation() {
  const val = (document.getElementById('fbLocation') || {}).value || 'auto';
  if (val === 'auto') return { ...lastContentContext };
  if (val === 'other') return { view: 'viewSubjects', subject: null, chapterIdx: 0, subMode: 'mcq' };
  if (val.startsWith('study:')) {
    return { view: 'viewStudy', subject: val.split(':')[1], chapterIdx: 0, subMode: 'mcq' };
  }
  return { view: val, subject: null, chapterIdx: 0, subMode: 'mcq' };
}

async function submitFeedback() {
  const textEl = document.getElementById('fbText');
  const btn = document.getElementById('fbSubmitBtn');
  const text = textEl.value.trim();
  if (text.length < 5) {
    alert('请再写清楚一点（至少 5 个字），这样才好定位问题 🙏');
    textEl.focus();
    return;
  }

  const report = {
    id: makeReportId(),
    text,
    contact: ((document.getElementById('fbContact') || {}).value || '').trim(),
    location: resolveSelectedLocation(),
    createdAt: Date.now(),
    status: 'pending',
    reply: null,
    acknowledged: false,
    sent: false,
  };

  const store = loadFeedbackStore();
  store.reports.unshift(report);
  saveFeedbackStore(store);

  if (btn) { btn.disabled = true; btn.textContent = '发送中…'; }
  const sent = await sendReportToAdmin(report);
  markReportSent(report.id, sent);
  if (btn) { btn.disabled = false; btn.textContent = '📮 提交申诉'; }

  textEl.value = '';
  if (typeof playSound === 'function') playSound(sent ? 'correct' : 'pop');
  showSubmitResult({ ...report, sent });
  renderMyReports();
}

function buildReportPlainText(report) {
  return [
    '【独中理科网站 · 问题申诉】',
    `问题编号：${report.id}`,
    `出问题的位置：${describeContext(report.location)}`,
    `提交时间：${new Date(report.createdAt).toLocaleString('zh-CN')}`,
    report.contact ? `联络方式：${report.contact}` : '',
    '',
    '问题描述：',
    report.text,
    '',
    `开发者处理码：${makeDevCode(report)}`,
  ].filter(line => line !== '').join('\n');
}

function showSubmitResult(report) {
  const box = document.getElementById('fbSubmitResult');
  if (!box) return;
  const plain = buildReportPlainText(report);
  const mailto = `mailto:?subject=${encodeURIComponent('独中理科网站问题申诉 ' + report.id)}&body=${encodeURIComponent(plain)}`;

  box.innerHTML = report.sent
    ? `<div class="fb-report-item" style="border-color: var(--primary);">
        <div class="fb-report-head">
          <span class="fb-status resolved">✅ 已送达管理员</span>
          <span class="fb-report-id">${escapeFb(report.id)}</span>
        </div>
        <div class="fb-report-text">谢谢反馈！管理员修好之后，你下次打开网站会看到通知小精灵。</div>
      </div>`
    : `<div class="fb-report-item" style="border-color: var(--danger);">
        <div class="fb-report-head">
          <span class="fb-status pending">⚠️ 自动发送失败</span>
          <span class="fb-report-id">${escapeFb(report.id)}</span>
        </div>
        <div class="fb-report-text">问题已记录在你的浏览器里，但暂时没能送出（可能是网络问题）。请用下面任一方式发给管理员：</div>
        <div style="display:flex; gap: 8px; margin-top: 12px; flex-wrap:wrap;">
          <button class="btn-ghost-retro" onclick="copyReportText('${escapeFb(report.id)}')">📋 复制问题内容</button>
          <a class="btn-ghost-retro" style="text-decoration:none; display:inline-block;" href="${mailto}">✉️ 用邮件发送</a>
          <button class="btn-ghost-retro" onclick="resendReport('${escapeFb(report.id)}')">🔁 重新发送</button>
        </div>
      </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function resendReport(id) {
  const report = loadFeedbackStore().reports.find(r => r.id === id);
  if (!report) return;
  const sent = await sendReportToAdmin(report);
  markReportSent(id, sent);
  showSubmitResult({ ...report, sent });
  renderMyReports();
}

function copyReportText(id) {
  const report = loadFeedbackStore().reports.find(r => r.id === id);
  if (!report) return;
  const text = buildReportPlainText(report);
  navigator.clipboard.writeText(text)
    .then(() => alert('已复制！直接粘贴发给管理员即可。'))
    .catch(() => prompt('请手动复制以下内容：', text));
}

function renderMyReports() {
  const box = document.getElementById('fbMyReports');
  if (!box) return;
  const reports = loadFeedbackStore().reports;
  if (!reports.length) {
    box.innerHTML = `<div class="archive-empty" style="padding: 24px;">你还没有提交过任何问题。</div>`;
    return;
  }
  box.innerHTML = reports.map(r => `
    <div class="fb-report-item">
      <div class="fb-report-head">
        <span class="fb-status ${r.status}">${r.status === 'resolved' ? '✅ 已解决' : '⏳ 处理中'}</span>
        <span class="fb-report-id">${escapeFb(r.id)}</span>
        <span class="fb-report-id">${new Date(r.createdAt).toLocaleDateString('zh-CN')}</span>
        <span class="fb-report-id">📍 ${escapeFb(describeContext(r.location))}</span>
        ${r.sent === false && r.status !== 'resolved' ? '<span class="fb-report-id" style="color:var(--danger);">未送达</span>' : ''}
      </div>
      <div class="fb-report-text">${escapeFb(r.text)}</div>
      ${r.reply ? `<div class="fb-report-reply"><strong>管理员回复：</strong>${escapeFb(r.reply.summary)}</div>` : ''}
      <div style="margin-top: 8px; display:flex; gap: 8px; flex-wrap:wrap;">
        ${r.sent === false && r.status !== 'resolved' ? `<button class="note-mini-btn" style="flex:0 0 auto;" onclick="resendReport('${escapeFb(r.id)}')">🔁 重新发送</button>` : ''}
        <button class="note-mini-btn" style="flex:0 0 auto;" onclick="copyReportText('${escapeFb(r.id)}')">📋 复制</button>
        <button class="note-mini-btn danger" style="flex:0 0 auto;" onclick="deleteReport('${escapeFb(r.id)}')">🗑️ 删除</button>
      </div>
    </div>`).join('');
}

function deleteReport(id) {
  if (!confirm('确定删除这条申诉记录？')) return;
  const store = loadFeedbackStore();
  store.reports = store.reports.filter(r => r.id !== id);
  saveFeedbackStore(store);
  renderMyReports();
  refreshSprite();
}

function escapeFb(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- 比对管理员的处理结果 ---------- */
async function syncResolutions() {
  let data = null;
  try {
    const res = await fetch(RESOLUTIONS_URL, { cache: 'no-cache' });
    if (!res.ok) return;
    data = await res.json();
  } catch (e) {
    return; // 离线或文件还没建立，安静跳过
  }
  const list = (data && data.resolutions) || [];

  const store = loadFeedbackStore();
  let changed = false;
  list.forEach(res => {
    const report = store.reports.find(r => r.id === res.reportId);
    if (report && report.status !== 'resolved') {
      report.status = 'resolved';
      report.reply = {
        summary: res.summary || '问题已修复',
        resolvedAt: res.resolvedAt || '',
        target: res.target || report.location,
      };
      report.acknowledged = false;
      changed = true;
    }
  });
  if (changed) saveFeedbackStore(store);
  refreshSprite();
}

/* ---------- 通知小精灵 ---------- */
let spriteReport = null;

function pendingSpriteReport() {
  return loadFeedbackStore().reports.find(r => r.status === 'resolved' && !r.acknowledged) || null;
}

function refreshSprite() {
  const wrap = document.getElementById('spriteWrap');
  if (!wrap) return;
  spriteReport = pendingSpriteReport();
  if (!spriteReport) {
    wrap.classList.remove('active');
    return;
  }
  const badge = document.getElementById('spriteBadge');
  if (badge) { badge.textContent = '!'; badge.style.display = ''; }
  document.getElementById('spritePanel').classList.remove('open');
  document.getElementById('spriteConnector').classList.add('hidden');
  wrap.classList.add('active');
}

function toggleSpritePanel() {
  if (!spriteReport) return;
  const panel = document.getElementById('spritePanel');
  const connector = document.getElementById('spriteConnector');
  const open = panel.classList.toggle('open');
  connector.classList.toggle('hidden', !open);
  if (typeof playSound === 'function') playSound('pop');

  if (open) {
    const summary = spriteReport.reply ? spriteReport.reply.summary : '问题已修复';
    document.getElementById('spritePanelTitle').innerHTML =
      `已解决 <em>【${escapeFb(summary)}】</em>，要查看吗？›`;
    const badge = document.getElementById('spriteBadge');
    if (badge) badge.style.display = 'none';
  }
}

function spriteGoLook() {
  if (!spriteReport) return;
  const target = (spriteReport.reply && spriteReport.reply.target) || spriteReport.location;
  document.getElementById('spritePanel').classList.remove('open');
  document.getElementById('spriteConnector').classList.add('hidden');
  navigateToTarget(target);
}

function navigateToTarget(target) {
  if (!target) return;
  if (typeof playSound === 'function') playSound('flip');

  if (target.view === 'viewStudy' && target.subject && typeof openSubject === 'function') {
    openSubject(target.subject, target.chapterIdx || 0);
    if (target.subMode && typeof switchSubSection === 'function') {
      setTimeout(() => switchSubSection(target.subMode), 700);
    }
    return;
  }
  if (target.view === 'viewNotes' && typeof openNotesView === 'function') return openNotesView();
  if (target.view === 'viewArchive' && typeof openArchiveView === 'function') return openArchiveView();
  if (target.view === 'viewFeedback' && typeof openFeedbackView === 'function') return openFeedbackView();
  if (typeof navigateHome === 'function') navigateHome();
}

function spriteConfirmFixed() {
  if (!spriteReport) return;
  const store = loadFeedbackStore();
  const report = store.reports.find(r => r.id === spriteReport.id);
  if (report) report.acknowledged = true;
  saveFeedbackStore(store);

  document.getElementById('spritePanel').classList.remove('open');
  document.getElementById('spriteConnector').classList.add('hidden');

  const bubble = document.getElementById('spriteBubble');
  bubble.textContent = '谢谢！';
  bubble.classList.add('show');
  if (typeof playSound === 'function') playSound('achieve');

  setTimeout(() => {
    const wrap = document.getElementById('spriteWrap');
    wrap.classList.add('leaving');
    setTimeout(() => {
      wrap.classList.remove('active', 'leaving');
      bubble.classList.remove('show');
      spriteReport = null;
      renderMyReports();
      // 可能还有别的已解决问题排队等着通知
      refreshSprite();
    }, 560);
  }, 3000);
}

function toggleSpriteNewIssue(btn) {
  const on = btn.classList.toggle('on');
  if (!on) return;
  if (typeof playSound === 'function') playSound('pop');
  document.getElementById('spriteNewIssue').classList.add('active');
  setTimeout(() => {
    const ta = document.getElementById('spriteIssueText');
    if (ta) ta.focus();
  }, 120);
}

function closeSpriteNewIssue() {
  document.getElementById('spriteNewIssue').classList.remove('active');
  const toggle = document.getElementById('spriteToggle');
  if (toggle) toggle.classList.remove('on');
}

async function submitSpriteNewIssue() {
  const ta = document.getElementById('spriteIssueText');
  const text = ta.value.trim();
  if (text.length < 5) {
    alert('请再写清楚一点（至少 5 个字）🙏');
    ta.focus();
    return;
  }
  const report = {
    id: makeReportId(),
    text,
    contact: '',
    location: (spriteReport && ((spriteReport.reply && spriteReport.reply.target) || spriteReport.location)) || { ...lastContentContext },
    createdAt: Date.now(),
    status: 'pending',
    reply: null,
    acknowledged: false,
    sent: false,
  };
  const store = loadFeedbackStore();
  store.reports.unshift(report);
  saveFeedbackStore(store);

  ta.value = '';
  closeSpriteNewIssue();
  const sent = await sendReportToAdmin(report);
  markReportSent(report.id, sent);
  if (typeof playSound === 'function') playSound(sent ? 'correct' : 'pop');
  alert(sent
    ? `已把新问题送给管理员（编号 ${report.id}），谢谢！`
    : `新问题已记录（编号 ${report.id}），但暂时没能送出。\n请到「网页问题申诉」页面点「重新发送」。`);
  renderMyReports();
}

/* 启动：比对处理结果并决定要不要弹小精灵 */
document.addEventListener('DOMContentLoaded', syncResolutions);
