/* ==========================================================================
   笔记模块：把题目导入成自己的笔记，并支持用鼠标／手指手写涂画、橡皮擦、撤销
   笔迹以「向量笔画」形式保存（而不是图片），因此体积小、可无限次重新编辑
   ========================================================================== */

const NOTES_STORAGE_KEY = 'UEC_NOTES_v1';

function loadNotesStore() {
  try {
    return JSON.parse(localStorage.getItem(NOTES_STORAGE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveNotesStore(store) {
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    alert('保存失败：浏览器本地存储空间已满，请先删除一些旧笔记。');
    return false;
  }
}

function noteIdFor(ctx) {
  return `${ctx.subject}__${ctx.chapterId}__${ctx.qType}__${ctx.qIndex}`;
}

function getNote(ctx) {
  return loadNotesStore()[noteIdFor(ctx)] || null;
}

/* ---------- 画布绘图引擎 ---------- */
const noteDraw = {
  canvas: null,
  ctx: null,
  strokes: [],
  current: null,
  drawing: false,
  tool: 'pen',
  color: '#1e293b',
  size: 3,
  stageWidth: 0,
};

function setupNoteCanvas(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 之后所有坐标都用 CSS 像素
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return ctx;
}

function drawSingleStroke(ctx, stroke, scale) {
  if (!stroke.pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = stroke.mode === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = Math.max(0.5, stroke.size * scale);

  if (stroke.pts.length === 1) {
    const [x, y] = stroke.pts[0];
    ctx.beginPath();
    ctx.arc(x * scale, y * scale, Math.max(0.5, (stroke.size * scale) / 2), 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    stroke.pts.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x * scale, y * scale);
      else ctx.lineTo(x * scale, y * scale);
    });
    ctx.stroke();
  }
  ctx.restore();
}

function redrawNoteCanvas() {
  const { canvas, ctx, strokes, stageWidth } = noteDraw;
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  strokes.forEach(s => {
    const scale = stageWidth / (s.w || stageWidth);
    drawSingleStroke(ctx, s, scale);
  });
}

function pointerPos(e) {
  const rect = noteDraw.canvas.getBoundingClientRect();
  return [
    Math.round((e.clientX - rect.left) * 10) / 10,
    Math.round((e.clientY - rect.top) * 10) / 10,
  ];
}

function attachDrawHandlers(canvas) {
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    noteDraw.drawing = true;
    noteDraw.current = {
      mode: noteDraw.tool,
      color: noteDraw.tool === 'eraser' ? '#000' : noteDraw.color,
      size: noteDraw.tool === 'eraser' ? noteDraw.size * 4 : noteDraw.size,
      w: noteDraw.stageWidth,
      pts: [pointerPos(e)],
    };
    noteDraw.strokes.push(noteDraw.current);
    redrawNoteCanvas();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!noteDraw.drawing || !noteDraw.current) return;
    e.preventDefault();
    const pt = pointerPos(e);
    const pts = noteDraw.current.pts;
    const last = pts[pts.length - 1];
    // 抽稀：距离太近的点不记录，笔迹数据量可以小很多
    if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 1.6) return;
    pts.push(pt);
    redrawNoteCanvas();
  });

  const endStroke = () => {
    if (!noteDraw.drawing) return;
    noteDraw.drawing = false;
    noteDraw.current = null;
    markNoteDirty();
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', endStroke);
}

/* ---------- 笔记编辑器 ---------- */
let activeNoteCtx = null;
let noteDirty = false;

function markNoteDirty() {
  noteDirty = true;
  const hint = document.getElementById('noteSaveHint');
  if (hint) hint.textContent = '有未保存的修改';
}

function buildSnapshotHtml(ctx) {
  const typeLabel = ctx.qType === 'mcq' ? '选择题' : '做答题';
  const optsHtml = (ctx.options || []).length
    ? `<div class="note-snapshot-opts">${ctx.options.map(o => `<div class="note-snapshot-opt">${escapeNoteHtml(o)}</div>`).join('')}</div>`
    : '';
  return `
    <span class="note-snapshot-tag">${escapeNoteHtml(ctx.chapterTitle)} · ${typeLabel}</span>
    <div class="note-snapshot-q">${escapeNoteHtml(ctx.questionText)}</div>
    ${optsHtml}
    <div class="note-snapshot-hint">↓ 下面的空白区可以自由手写／涂画，题目本身只作参考底图</div>
  `;
}

function escapeNoteHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openNoteEditor(ctx) {
  if (!ctx) return;
  if (typeof playSound === 'function') playSound('pop');
  activeNoteCtx = ctx;
  noteDirty = false;

  const existing = getNote(ctx);
  const modal = document.getElementById('noteModal');
  const snapshot = document.getElementById('noteSnapshot');
  const stage = document.getElementById('noteStage');
  const canvas = document.getElementById('noteCanvas');
  const textArea = document.getElementById('noteTextInput');

  snapshot.innerHTML = buildSnapshotHtml(ctx);
  textArea.value = existing ? (existing.textNote || '') : '';
  document.getElementById('noteSaveHint').textContent = existing
    ? `上次保存：${new Date(existing.updatedAt).toLocaleString('zh-CN')}`
    : '尚未保存';

  modal.classList.add('active');

  // 必须等弹窗显示后才能量到真实宽度
  requestAnimationFrame(() => {
    const stageWidth = stage.clientWidth;
    const snapshotHeight = snapshot.offsetHeight;
    const stageHeight = Math.max(snapshotHeight + 260, 460);
    stage.style.height = stageHeight + 'px';

    noteDraw.canvas = canvas;
    noteDraw.stageWidth = stageWidth;
    noteDraw.ctx = setupNoteCanvas(canvas, stageWidth, stageHeight);

    // 事件只绑一次，否则每开一次笔记就会多叠一层监听
    if (!canvas.dataset.handlersAttached) {
      attachDrawHandlers(canvas);
      canvas.dataset.handlersAttached = '1';
    }
    noteDraw.strokes = existing && Array.isArray(existing.strokes)
      ? JSON.parse(JSON.stringify(existing.strokes))
      : [];
    redrawNoteCanvas();
  });
}

function closeNoteEditor(force) {
  if (noteDirty && !force) {
    if (!confirm('笔记还没保存，确定要关闭吗？')) return;
  }
  document.getElementById('noteModal').classList.remove('active');
  noteDraw.strokes = [];
  noteDraw.ctx = null;
  activeNoteCtx = null;
  noteDirty = false;
}

function saveCurrentNote() {
  if (!activeNoteCtx) return;
  const store = loadNotesStore();
  const id = noteIdFor(activeNoteCtx);
  const textNote = document.getElementById('noteTextInput').value.trim();

  if (noteDraw.strokes.length === 0 && !textNote) {
    // 空笔记等同于删除，避免列表里堆一堆空卡片
    if (store[id]) {
      delete store[id];
      saveNotesStore(store);
    }
    noteDirty = false;
    closeNoteEditor(true);
    refreshNoteButtons();
    if (typeof playSound === 'function') playSound('flip');
    return;
  }

  store[id] = {
    id,
    subject: activeNoteCtx.subject,
    subjectLabel: (typeof SUBJECT_LABELS !== 'undefined' && SUBJECT_LABELS[activeNoteCtx.subject]) || activeNoteCtx.subject,
    chapterId: activeNoteCtx.chapterId,
    chapterIdx: activeNoteCtx.chapterIdx,
    chapterTitle: activeNoteCtx.chapterTitle,
    qType: activeNoteCtx.qType,
    qIndex: activeNoteCtx.qIndex,
    questionText: activeNoteCtx.questionText,
    options: activeNoteCtx.options || [],
    strokes: noteDraw.strokes,
    baseWidth: noteDraw.stageWidth,
    textNote,
    createdAt: (store[id] && store[id].createdAt) || Date.now(),
    updatedAt: Date.now(),
  };

  if (saveNotesStore(store)) {
    noteDirty = false;
    document.getElementById('noteSaveHint').textContent = '已保存 ✓';
    if (typeof playSound === 'function') playSound('correct');
    refreshNoteButtons();
    setTimeout(() => closeNoteEditor(true), 420);
  }
}

/* ---------- 工具栏操作 ---------- */
function setNoteTool(tool, el) {
  noteDraw.tool = tool;
  document.querySelectorAll('[data-note-tool]').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  const canvas = document.getElementById('noteCanvas');
  if (canvas) canvas.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
}

function setNoteColor(color, el) {
  noteDraw.color = color;
  noteDraw.tool = 'pen';
  document.querySelectorAll('.note-color-dot').forEach(d => d.classList.remove('selected'));
  if (el) el.classList.add('selected');
  document.querySelectorAll('[data-note-tool]').forEach(b => b.classList.remove('active'));
  const penBtn = document.querySelector('[data-note-tool="pen"]');
  if (penBtn) penBtn.classList.add('active');
  const canvas = document.getElementById('noteCanvas');
  if (canvas) canvas.style.cursor = 'crosshair';
}

function setNoteSize(val) {
  noteDraw.size = Number(val);
}

function undoNoteStroke() {
  if (!noteDraw.strokes.length) return;
  noteDraw.strokes.pop();
  redrawNoteCanvas();
  markNoteDirty();
  if (typeof playSound === 'function') playSound('flip');
}

function clearNoteCanvas() {
  if (!noteDraw.strokes.length) return;
  if (!confirm('确定清空所有笔迹吗？（文字备注不受影响）')) return;
  noteDraw.strokes = [];
  redrawNoteCanvas();
  markNoteDirty();
}

/* ---------- 题目卡上的笔记按钮 ---------- */
function currentMcqNoteContext() {
  const sec = (fullDatabase.sections || [])[activeChapterIdx];
  if (!sec || !sec.mcqs || !sec.mcqs[currentMcqIdx]) return null;
  const item = sec.mcqs[currentMcqIdx];
  return {
    subject: currentSubject,
    chapterId: sec.id,
    chapterIdx: activeChapterIdx,
    chapterTitle: sec.title,
    qType: 'mcq',
    qIndex: currentMcqIdx,
    questionText: item.q,
    options: item.options || [],
  };
}

function subjNoteContext(qIndex) {
  const sec = (fullDatabase.sections || [])[activeChapterIdx];
  if (!sec || !sec.subjectives || !sec.subjectives[qIndex]) return null;
  const item = sec.subjectives[qIndex];
  return {
    subject: currentSubject,
    chapterId: sec.id,
    chapterIdx: activeChapterIdx,
    chapterTitle: sec.title,
    qType: 'subj',
    qIndex,
    questionText: item.question,
    options: [],
  };
}

function openMcqNote() { openNoteEditor(currentMcqNoteContext()); }
function openSubjNote(qIndex) { openNoteEditor(subjNoteContext(qIndex)); }

// 已经有笔记的题目，按钮显示成高亮的"已有笔记"
function refreshNoteButtons() {
  const store = loadNotesStore();
  document.querySelectorAll('[data-note-key]').forEach(btn => {
    const has = !!store[btn.getAttribute('data-note-key')];
    btn.classList.toggle('has-note', has);
    if (window.setBtnLabel) window.setBtnLabel(btn, has ? 'notebook' : 'pencil', has ? '已有笔记' : '做笔记');
    else btn.textContent = has ? '已有笔记' : '做笔记';
  });
}

/* ---------- 笔记列表页 ---------- */
function renderNotesView() {
  const area = document.getElementById('notesListArea');
  if (!area) return;
  const store = loadNotesStore();
  const notes = Object.values(store).sort((a, b) => b.updatedAt - a.updatedAt);

  if (notes.length === 0) {
    area.innerHTML = `
      <div class="archive-empty">
        <div style="margin-bottom: 10px;"><svg class="ic" aria-hidden="true"><use href="#i-notebook"></use></svg></div>
        还没有任何笔记。<br>
        <span style="font-size: 13px;">进入任意科目，在题目卡右下角点「做笔记」即可把该题导入成自己的笔记。</span>
      </div>`;
    return;
  }

  area.innerHTML = `<div class="notes-grid">${notes.map(n => `
    <div class="note-card">
      <div class="note-card-preview"><canvas data-preview-for="${escapeNoteHtml(n.id)}"></canvas></div>
      <div class="note-card-body">
        <span class="note-card-chapter">${escapeNoteHtml(n.subjectLabel || '')} · ${escapeNoteHtml(n.chapterTitle)}</span>
        <div class="note-card-q">${escapeNoteHtml(n.textNote || n.questionText)}</div>
        <div class="note-card-time">更新于 ${new Date(n.updatedAt).toLocaleString('zh-CN')}</div>
      </div>
      <div class="note-card-actions">
        <button class="note-mini-btn" onclick="editNoteById('${escapeNoteHtml(n.id)}')"><svg class="ic" aria-hidden="true"><use href="#i-pencil"></use></svg>编辑</button>
        <button class="note-mini-btn is-time" onclick="gotoNoteQuestion('${escapeNoteHtml(n.id)}')"><svg class="ic" aria-hidden="true"><use href="#i-link"></use></svg>前往该题</button>
        <button class="note-mini-btn danger" onclick="deleteNoteById('${escapeNoteHtml(n.id)}')"><svg class="ic" aria-hidden="true"><use href="#i-trash"></use></svg>删除</button>
      </div>
    </div>
  `).join('')}</div>`;

  // 给每张卡片画出笔迹缩略图
  notes.forEach(n => {
    const cvs = area.querySelector(`[data-preview-for="${n.id}"]`);
    if (cvs) renderNotePreview(cvs, n);
  });
}

function renderNotePreview(canvas, note) {
  const W = 240, H = 130;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  if (!note.strokes || !note.strokes.length) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('（纯文字笔记）', W / 2, H / 2);
    return;
  }

  // 依笔迹的实际范围裁切缩放，缩略图才不会是一片空白
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  note.strokes.forEach(s => s.pts.forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }));
  const bw = Math.max(maxX - minX, 40);
  const bh = Math.max(maxY - minY, 40);
  const scale = Math.min(W / (bw + 30), H / (bh + 30), 1);

  ctx.save();
  ctx.translate(-(minX - 15) * scale, -(minY - 15) * scale);
  note.strokes.forEach(s => drawSingleStroke(ctx, s, scale));
  ctx.restore();
}

function editNoteById(id) {
  const note = loadNotesStore()[id];
  if (!note) return;
  openNoteEditor({
    subject: note.subject,
    chapterId: note.chapterId,
    chapterIdx: note.chapterIdx,
    chapterTitle: note.chapterTitle,
    qType: note.qType,
    qIndex: note.qIndex,
    questionText: note.questionText,
    options: note.options || [],
  });
}

function deleteNoteById(id) {
  if (!confirm('确定删除这则笔记？删除后无法恢复。')) return;
  const store = loadNotesStore();
  delete store[id];
  saveNotesStore(store);
  if (typeof playSound === 'function') playSound('wrong');
  renderNotesView();
}

function gotoNoteQuestion(id) {
  const note = loadNotesStore()[id];
  if (!note) return;
  if (typeof openSubject !== 'function') return;
  openSubject(note.subject, note.chapterIdx);
  setTimeout(() => {
    if (typeof switchSubSection === 'function') {
      switchSubSection(note.qType === 'mcq' ? 'mcq' : 'subj');
    }
    if (note.qType === 'mcq' && typeof jumpToWrongQuestion === 'function') {
      jumpToWrongQuestion(note.chapterIdx, note.qIndex);
    }
  }, 650);
}
