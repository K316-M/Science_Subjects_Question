/* ==========================================================================
   网页问题申诉模块
   ---------------------------------------------------------------------------
   这是一个纯静态网站（没有后端服务器），所以申诉的「往返」是这样闭环的：
     1. 用户提交问题 → 存进他自己浏览器的 localStorage，并拿到一个问题编号
     2. 用户把问题内容（含编号）发给管理员：一键复制 / 邮件 / 自动 POST（可选配置）
     3. 管理员修好后，把「编号 + 处理说明 + 出问题的位置」写进仓库的
        data/resolved_issues.json 并推送
     4. 用户下次打开网站 → 自动比对本地的待处理问题 → 命中就弹出通知小精灵
   如果想要真正的自动收件，把下面的 FEEDBACK_ENDPOINT 填成表单服务（如 Formspree）
   的接口地址即可，其余流程不必改动。
   ========================================================================== */

const FEEDBACK_ENDPOINT = ''; // 例：'https://formspree.io/f/xxxxxxx'
const FEEDBACK_STORAGE_KEY = 'UEC_FEEDBACK_v1';
const RESOLUTIONS_URL = '/data/resolved_issues.json';

const VIEW_LABELS = {
  viewSubjects: '主页（学科选择）',
  viewStudy: '做题页',
  viewNotes: '笔记页',
  viewArchive: '题目档页',
  viewFeedback: '网页问题申诉页',
  viewAdmin: '管理员待审核预览',
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
  renderDevChannel();
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
  const text = textEl.value.trim();
  if (text.length < 5) {
    alert('请再写清楚一点（至少 5 个字），这样才好定位问题 🙏');
    textEl.focus();
    return;
  }

  const report = {
    id: makeReportId(),
    text,
    contact: (document.getElementById('fbContact') || {}).value?.trim() || '',
    location: resolveSelectedLocation(),
    createdAt: Date.now(),
    status: 'pending',
    reply: null,
    acknowledged: false,
  };

  const store = loadFeedbackStore();
  store.reports.unshift(report);
  saveFeedbackStore(store);

  if (FEEDBACK_ENDPOINT) {
    try {
      await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: report.id,
          message: report.text,
          contact: report.contact,
          location: describeContext(report.location),
          locationRaw: report.location,
        }),
      });
    } catch (e) {
      console.warn('自动发送失败，用户仍可手动复制／邮件发送：', e.message);
    }
  }

  textEl.value = '';
  if (typeof playSound === 'function') playSound('correct');
  showSubmitResult(report);
  renderMyReports();
  renderDevChannel();
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
  ].filter(Boolean).join('\n');
}

function showSubmitResult(report) {
  const box = document.getElementById('fbSubmitResult');
  if (!box) return;
  const plain = buildReportPlainText(report);
  const mailto = `mailto:?subject=${encodeURIComponent('独中理科网站问题申诉 ' + report.id)}&body=${encodeURIComponent(plain)}`;
  box.innerHTML = `
    <div class="fb-report-item" style="border-color: var(--primary);">
      <div class="fb-report-head">
        <span class="fb-status resolved">✅ 已记录</span>
        <span class="fb-report-id">${escapeFb(report.id)}</span>
      </div>
      <div class="fb-report-text">问题已记录在你的浏览器里。${FEEDBACK_ENDPOINT ? '并已自动发送给管理员。' : '请用下面任一方式把它发给管理员，管理员修好后你会在网站上收到通知。'}</div>
      <div style="display:flex; gap:8px; margin-top:11px; flex-wrap:wrap;">
        <button class="btn-ghost-retro" onclick="copyReportText('${escapeFb(report.id)}')">📋 复制问题内容</button>
        <a class="btn-ghost-retro" style="text-decoration:none; display:inline-block;" href="${mailto}">✉️ 用邮件发送</a>
      </div>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    box.innerHTML = `<div class="archive-empty" style="padding:26px;">你还没有提交过任何问题。</div>`;
    return;
  }
  box.innerHTML = reports.map(r => `
    <div class="fb-report-item">
      <div class="fb-report-head">
        <span class="fb-status ${r.status}">${r.status === 'resolved' ? '✅ 已解决' : '⏳ 处理中'}</span>
        <span class="fb-report-id">${escapeFb(r.id)}</span>
        <span class="fb-report-id">${new Date(r.createdAt).toLocaleDateString('zh-CN')}</span>
        <span class="fb-report-id">📍 ${escapeFb(describeContext(r.location))}</span>
      </div>
      <div class="fb-report-text">${escapeFb(r.text)}</div>
      ${r.reply ? `<div class="fb-report-reply"><strong>管理员回复：</strong>${escapeFb(r.reply.summary)}</div>` : ''}
      <div style="margin-top:9px; display:flex; gap:7px; flex-wrap:wrap;">
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
  renderDevChannel();
  refreshSprite();
}

function escapeFb(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------- 开发者专属通道（?dev=1） ---------- */
function isDevMode() {
  try {
    return new URLSearchParams(window.location.search).get('dev') === '1';
  } catch (e) {
    return false;
  }
}

function renderDevChannel() {
  const box = document.getElementById('fbDevChannel');
  if (!box) return;
  if (!isDevMode()) { box.innerHTML = ''; return; }

  const reports = loadFeedbackStore().reports;
  box.innerHTML = `
    <h3 class="page-heading" style="font-size:18px; margin-top:30px;">🛠️ 开发者通道</h3>
    <p class="fb-hint" style="margin-bottom:12px;">
      这一区只有网址带 <code>?dev=1</code> 时才看得到。下面可以把任何一条问题标记为已解决，
      系统会生成要贴进仓库 <code>data/resolved_issues.json</code> 的内容；推送之后，
      提交该问题的用户下次打开网站就会看到通知小精灵。
    </p>
    ${reports.length === 0 ? '<div class="archive-empty" style="padding:20px;">本机没有申诉记录。</div>' : reports.map(r => `
      <div class="fb-report-item">
        <div class="fb-report-head">
          <span class="fb-status ${r.status}">${r.status === 'resolved' ? '已解决' : '处理中'}</span>
          <span class="fb-report-id">${escapeFb(r.id)}</span>
        </div>
        <div class="fb-report-text">${escapeFb(r.text)}</div>
        <div class="fb-field" style="margin-top:10px;">
          <input class="fb-input" id="devSummary_${escapeFb(r.id)}" placeholder="处理说明（会显示给用户，例：错题本按钮已修好）">
        </div>
        <button class="btn-ghost-retro" onclick="devGenerateResolution('${escapeFb(r.id)}')">生成 JSON 片段</button>
      </div>`).join('')}
    <div class="fb-field" style="margin-top:12px;">
      <label class="fb-label">要贴进 data/resolved_issues.json 的内容</label>
      <textarea class="fb-textarea" id="devJsonOut" readonly placeholder="点上面的「生成 JSON 片段」后显示在这里"></textarea>
    </div>`;
}

function devGenerateResolution(id) {
  const report = loadFeedbackStore().reports.find(r => r.id === id);
  if (!report) return;
  const summary = (document.getElementById('devSummary_' + id) || {}).value?.trim() || '问题已修复';
  const entry = {
    reportId: report.id,
    summary,
    resolvedAt: new Date().toISOString().slice(0, 10),
    target: report.location,
  };
  const out = document.getElementById('devJsonOut');
  if (out) {
    out.value = JSON.stringify(entry, null, 2);
    out.select();
  }
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
  if (!list.length) return;

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
  if (badge) badge.textContent = '!';
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
    if (badge) badge.textContent = '';
    badge.style.display = 'none';
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
  const dialog = document.getElementById('spriteNewIssue');
  dialog.classList.add('active');
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

function submitSpriteNewIssue() {
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
  };
  const store = loadFeedbackStore();
  store.reports.unshift(report);
  saveFeedbackStore(store);

  ta.value = '';
  closeSpriteNewIssue();
  if (typeof playSound === 'function') playSound('correct');
  alert(`已记录新问题（编号 ${report.id}）。\n可以到「网页问题申诉」页面把它复制发给管理员。`);
  renderMyReports();
  renderDevChannel();
}

/* 启动：比对处理结果并决定要不要弹小精灵 */
document.addEventListener('DOMContentLoaded', () => {
  renderDevChannel();
  syncResolutions();
});
