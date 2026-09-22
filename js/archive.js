/* ==========================================================================
   题目档模块：勾选需要的题目 → 一键下载成 PDF
   题目一律依照网站本身的顺序（科目 → 章节 → 选择题 → 做答题）排版，
   与用户勾选的先后次序无关。
   ========================================================================== */

const ARCHIVE_SUBJECTS = ['biology', 'chemistry', 'physics'];

const archiveState = {
  subject: 'biology',
  banks: {},            // 已抓取的各科题库缓存
  selected: new Set(),  // 元素为 selKey()
  includeAnswers: true,
  loading: false,
};

function selKey(subject, chapterIdx, type, qIndex) {
  return `${subject}|${chapterIdx}|${type}|${qIndex}`;
}

async function fetchBank(subject) {
  if (archiveState.banks[subject]) return archiveState.banks[subject];
  try {
    const res = await fetch(`/papers/${subject}_question_bank.json`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    archiveState.banks[subject] = data.sections ? data : { sections: [] };
  } catch (e) {
    console.warn(`题目档：载入 ${subject} 题库失败`, e.message);
    archiveState.banks[subject] = { sections: [] };
  }
  return archiveState.banks[subject];
}

async function renderArchiveView() {
  const area = document.getElementById('archiveListArea');
  if (!area) return;
  area.innerHTML = `<div class="archive-empty">正在载入题库…</div>`;

  document.querySelectorAll('.archive-tab').forEach(t => {
    const on = t.getAttribute('data-arc-subject') === archiveState.subject;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
    t.setAttribute('tabindex', on ? '0' : '-1');
  });

  const bank = await fetchBank(archiveState.subject);
  const sections = bank.sections || [];
  const withQuestions = sections
    .map((sec, idx) => ({ sec, idx }))
    .filter(({ sec }) => (sec.mcqs || []).length > 0 || (sec.subjectives || []).length > 0);

  if (withQuestions.length === 0) {
    area.innerHTML = `<div class="archive-empty">
      <div style="font-size: 40px; margin-bottom: 10px;">📭</div>
      该科目题库还没有题目可供下载。
    </div>`;
    updateArchiveCount();
    return;
  }

  area.innerHTML = withQuestions.map(({ sec, idx }) => {
    const mcqs = sec.mcqs || [];
    const subjs = sec.subjectives || [];
    const total = mcqs.length + subjs.length;

    const rows = [
      ...mcqs.map((q, i) => archiveRowHtml(archiveState.subject, idx, 'mcq', i, q.q)),
      ...subjs.map((q, i) => archiveRowHtml(archiveState.subject, idx, 'subj', i, q.question)),
    ].join('');

    return `
      <div class="archive-chapter">
        <div class="archive-chapter-head" onclick="toggleArchiveChapter(this)" role="button" tabindex="0">
          <span style="font-size:13px;">▸</span>
          <span class="archive-chapter-title">${escapeArc(sec.title)}</span>
          <span class="archive-chapter-count">${total} 题</span>
          <button class="note-mini-btn" style="flex:0 0 auto; max-width:96px;"
            onclick="event.stopPropagation(); toggleChapterSelection('${archiveState.subject}', ${idx})">全选／取消</button>
        </div>
        <div class="archive-chapter-body">${rows}</div>
      </div>`;
  }).join('');

  syncArchiveCheckboxes();
  updateArchiveCount();
}

function archiveRowHtml(subject, chapterIdx, type, qIndex, text) {
  const key = selKey(subject, chapterIdx, type, qIndex);
  const badge = type === 'mcq'
    ? '<span class="archive-q-badge mcq">选择</span>'
    : '<span class="archive-q-badge subj">做答</span>';
  const preview = String(text || '').replace(/\s+/g, ' ').slice(0, 90);
  return `
    <label class="archive-q-row">
      <input type="checkbox" data-sel-key="${key}" onchange="toggleArchiveSelection('${key}', this.checked)">
      <span class="archive-q-text">${badge}${escapeArc(preview)}${String(text || '').length > 90 ? '…' : ''}</span>
    </label>`;
}

function escapeArc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toggleArchiveChapter(headEl) {
  const body = headEl.nextElementSibling;
  const open = body.classList.toggle('open');
  headEl.querySelector('span').textContent = open ? '▾' : '▸';
  if (typeof playSound === 'function') playSound('flip');
}

function toggleArchiveSelection(key, checked) {
  if (checked) archiveState.selected.add(key);
  else archiveState.selected.delete(key);
  updateArchiveCount();
}

function toggleChapterSelection(subject, chapterIdx) {
  const prefix = `${subject}|${chapterIdx}|`;
  const boxes = document.querySelectorAll(`[data-sel-key^="${prefix}"]`);
  if (!boxes.length) return;
  const allSelected = Array.from(boxes).every(b => archiveState.selected.has(b.getAttribute('data-sel-key')));
  boxes.forEach(b => {
    const key = b.getAttribute('data-sel-key');
    if (allSelected) { archiveState.selected.delete(key); b.checked = false; }
    else { archiveState.selected.add(key); b.checked = true; }
  });
  updateArchiveCount();
  if (typeof playSound === 'function') playSound('pop');
}

function syncArchiveCheckboxes() {
  document.querySelectorAll('[data-sel-key]').forEach(b => {
    b.checked = archiveState.selected.has(b.getAttribute('data-sel-key'));
  });
}

function updateArchiveCount() {
  const el = document.getElementById('archiveCount');
  if (el) el.textContent = `已选 ${archiveState.selected.size} 题`;
  const btn = document.getElementById('archiveDownloadBtn');
  if (btn) btn.disabled = archiveState.selected.size === 0;
}

function switchArchiveSubject(subject) {
  archiveState.subject = subject;
  if (typeof playSound === 'function') playSound('flip');
  renderArchiveView();
}

function clearArchiveSelection() {
  archiveState.selected.clear();
  syncArchiveCheckboxes();
  updateArchiveCount();
  if (typeof playSound === 'function') playSound('wrong');
}

function setArchiveIncludeAnswers(checked) {
  archiveState.includeAnswers = checked;
}

/* ---------- 组装：永远按网站顺序输出 ---------- */
async function collectSelectedInSiteOrder() {
  const out = [];
  for (const subject of ARCHIVE_SUBJECTS) {
    const hasAny = Array.from(archiveState.selected).some(k => k.startsWith(subject + '|'));
    if (!hasAny) continue;

    const bank = await fetchBank(subject);
    const sections = bank.sections || [];
    const subjectLabel = (typeof SUBJECT_LABELS !== 'undefined' && SUBJECT_LABELS[subject]) || subject;
    const chapters = [];

    sections.forEach((sec, chapterIdx) => {
      const picked = [];
      (sec.mcqs || []).forEach((q, i) => {
        if (archiveState.selected.has(selKey(subject, chapterIdx, 'mcq', i))) picked.push({ type: 'mcq', data: q });
      });
      (sec.subjectives || []).forEach((q, i) => {
        if (archiveState.selected.has(selKey(subject, chapterIdx, 'subj', i))) picked.push({ type: 'subj', data: q });
      });
      if (picked.length) chapters.push({ title: sec.title, items: picked });
    });

    if (chapters.length) out.push({ subject, subjectLabel, chapters });
  }
  return out;
}

/* ---------- PDF 生成 ---------- */
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('无法载入 ' + src));
    document.head.appendChild(s);
  });
}

async function loadPdfLibs() {
  if (window.html2canvas && window.jspdf) return;
  await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
}

function setPdfProgress(active, text, sub) {
  const box = document.getElementById('pdfProgress');
  if (!box) return;
  box.classList.toggle('active', !!active);
  if (text) document.getElementById('pdfProgressText').textContent = text;
  if (sub !== undefined) document.getElementById('pdfProgressSub').textContent = sub;
}

function figureHtmlForPdf(item) {
  if (item.image) return `<div class="pdf-q-figure"><img src="${escapeArc(item.image)}" crossorigin="anonymous"></div>`;
  if (item.figure) return `<div class="pdf-q-figure">${item.figure}</div>`;
  return '';
}

function buildPdfBlocks(groups) {
  const blocks = [];
  const totalCount = groups.reduce((n, g) => n + g.chapters.reduce((m, c) => m + c.items.length, 0), 0);
  const today = new Date().toLocaleDateString('zh-CN');

  blocks.push(`
    <div class="pdf-block pdf-title-block">
      <h1>独中理科 · 题目档</h1>
      <p>董总华文独中高中统考 · 自选练习卷</p>
      <p style="margin-top:14px;">共 ${totalCount} 题　|　${groups.map(g => escapeArc(g.subjectLabel)).join('、')}　|　生成日期：${today}</p>
      <p style="margin-top:10px; font-size:12px; color:#777;">${archiveState.includeAnswers ? '本卷含参考答案与解析' : '本卷不含答案（纯做题版）'}</p>
    </div>`);

  let qNo = 0;
  groups.forEach(group => {
    group.chapters.forEach(chapter => {
      blocks.push(`
        <div class="pdf-block">
          <div class="pdf-chapter-head">${escapeArc(group.subjectLabel)}　${escapeArc(chapter.title)}</div>
        </div>`);

      chapter.items.forEach(({ type, data }) => {
        qNo++;
        if (type === 'mcq') {
          const opts = (data.options || []).map(o => `<div class="pdf-q-opt">${escapeArc(o)}</div>`).join('');
          const ansIdx = typeof data.answer === 'number' ? data.answer : -1;
          const ansLetter = ansIdx >= 0 ? 'ABCD'[ansIdx] || '?' : '?';
          const answerHtml = archiveState.includeAnswers
            ? `<div class="pdf-q-answer"><strong>答案：${ansLetter}</strong>${data.explanation ? '\n' + escapeArc(data.explanation) : ''}</div>`
            : '';
          blocks.push(`
            <div class="pdf-block">
              <div class="pdf-q-num">${qNo}.</div>
              <div class="pdf-q-text">${escapeArc(data.q)}</div>
              ${figureHtmlForPdf(data)}
              <div class="pdf-q-opts">${opts}</div>
              ${answerHtml}
            </div>`);
        } else {
          const answerHtml = archiveState.includeAnswers && data.answer
            ? `<div class="pdf-q-answer"><strong>参考答案：</strong>\n${escapeArc(stripHtml(data.answer))}</div>`
            : '';
          blocks.push(`
            <div class="pdf-block">
              <div class="pdf-q-num">${qNo}.（做答题）</div>
              <div class="pdf-q-text">${escapeArc(data.question)}</div>
              ${figureHtmlForPdf(data)}
              ${answerHtml}
            </div>`);
        }
      });
    });
  });

  return blocks;
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').trim();
}

function addCanvasToPdf(pdf, canvas, state) {
  const { margin, usableW, pageH } = state;
  const maxBlockH = pageH - margin * 2;
  const fullH = (canvas.height / canvas.width) * usableW;

  if (fullH <= maxBlockH) {
    if (state.cursorY + fullH > pageH - margin) {
      pdf.addPage();
      state.cursorY = margin;
    }
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, state.cursorY, usableW, fullH);
    state.cursorY += fullH + 10;
    return;
  }

  // 单个区块超过一页：按页高切片，避免内容被截断丢失
  const pxPerPt = canvas.width / usableW;
  let srcY = 0;
  while (srcY < canvas.height) {
    const availPt = pageH - margin - state.cursorY;
    if (availPt < 40) { pdf.addPage(); state.cursorY = margin; continue; }
    const sliceH = Math.min(canvas.height - srcY, Math.floor(availPt * pxPerPt));
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = sliceH;
    slice.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    const hPt = sliceH / pxPerPt;
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, state.cursorY, usableW, hPt);
    state.cursorY += hPt;
    srcY += sliceH;
    if (srcY < canvas.height) { pdf.addPage(); state.cursorY = margin; }
  }
  state.cursorY += 10;
}

async function downloadArchivePdf() {
  if (archiveState.selected.size === 0) return;
  if (archiveState.loading) return;
  archiveState.loading = true;

  try {
    setPdfProgress(true, '正在准备…', '首次下载需要载入 PDF 组件');
    await loadPdfLibs();

    const groups = await collectSelectedInSiteOrder();
    const blocks = buildPdfBlocks(groups);

    const stage = document.getElementById('pdfStage');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 40;
    const state = {
      margin,
      usableW: pdf.internal.pageSize.getWidth() - margin * 2,
      pageH: pdf.internal.pageSize.getHeight(),
      cursorY: margin,
    };

    for (let i = 0; i < blocks.length; i++) {
      setPdfProgress(true, '正在生成 PDF…', `第 ${i + 1} / ${blocks.length} 个区块`);
      stage.innerHTML = blocks[i];
      const target = stage.firstElementChild;
      // 等图片解码完成，否则 html2canvas 会画出空白图
      await waitForImages(target);
      const canvas = await window.html2canvas(target, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      addCanvasToPdf(pdf, canvas, state);
    }

    stage.innerHTML = '';
    setPdfProgress(true, '正在保存…', '');
    const fname = `独中理科题目档_${new Date().toISOString().slice(0, 10)}.pdf`;
    pdf.save(fname);
    setPdfProgress(false);
    if (typeof playSound === 'function') playSound('achieve');
  } catch (e) {
    console.error(e);
    setPdfProgress(false);
    alert('生成 PDF 失败：' + e.message + '\n\n如果目前没有网络，PDF 组件无法载入，请连上网络后重试，或改用「打印版」按钮。');
  } finally {
    archiveState.loading = false;
  }
}

function waitForImages(el) {
  const imgs = Array.from(el.querySelectorAll('img'));
  if (!imgs.length) return Promise.resolve();
  return Promise.all(imgs.map(img => (img.complete
    ? Promise.resolve()
    : new Promise(res => { img.onload = res; img.onerror = res; }))));
}

/* 备用方案：直接调用浏览器打印（可另存为 PDF），离线时也能用 */
async function printArchive() {
  if (archiveState.selected.size === 0) return;
  const groups = await collectSelectedInSiteOrder();
  const blocks = buildPdfBlocks(groups);
  const win = window.open('', '_blank');
  if (!win) { alert('浏览器拦截了新窗口，请允许弹出窗口后再试。'); return; }
  win.document.write(`<!DOCTYPE html><html lang="zh-MY"><head><meta charset="UTF-8">
    <title>独中理科 · 题目档</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/css/features.css">
    <style>body{margin:0;background:#fff;} .pdf-block{page-break-inside:avoid;}</style>
    </head><body>${blocks.join('')}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 800);
}
