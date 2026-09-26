/* 跨装置同步
 * ------------------------------------------------------------
 * 刻意不做帐号：使用者是中学生，收 email／密码有个资义务，也多一层安全风险。
 * 改用「同步码」—— 一串 20 码的随机字串就是这份资料的钥匙，不含任何个人资料。
 * 伺服器只负责存取一个 JSON，合并逻辑全在这里，因为只有前端知道各笔资料的语意。
 */
(function () {
  'use strict';

  const STATE_KEY = 'UEC_SYNC_v1';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉 0/O/1/I/L 这类看错的字
  const CODE_LEN = 20;                                   // 约 100 bits，猜不到
  const AUTO_EVERY_MS = 60 * 1000;

  // 每一把键怎么合并，取决於它的资料形状 —— 这是同步做得对不对的关键
  const KEYS = [
    'UEC_PROGRESS_v1',
    'UEC_NOTES_v1',
    'UEC_FEEDBACK_v1',
    'UEC_LAST_VISIT_v1',
    'UEC_REVIEW_v1',
    'UEC_SUBJ_ATTEMPTS_v1',
    'UEC_NOTES_DELETED_v1',          // 删掉的笔记：{笔记id: 删除时间}，不然另一台装置会把它同步回来
    'UEC_TOUR_v1',                   // 哪些画面的导览看过了：任何一台看过就算看过
    'UEC_BIO_HL_STORE_OFFICIAL_19',
  ];
  const NOTE_TOMBSTONE_DAYS = 365;   // 删除纪录留一年，够所有装置同步到

  /* ---------- 本机状态 ---------- */
  const readJson = (k, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  };
  const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  // notesBase：上次同步完每则笔记的 updatedAt，用来分辨「只有一边改过」还是「两边都改过」
  // history：这台装置用过的同步码（换码或断开时记下来），面板里可以切回去
  const loadState = () => Object.assign({ code: '', baseVer: 0, lastSyncAt: 0, snapshot: {}, notesBase: {}, history: [] },
    readJson(STATE_KEY, {}));
  const saveState = (s) => writeJson(STATE_KEY, s);

  function makeCode() {
    const bytes = new Uint8Array(CODE_LEN);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
  }
  const pretty = code => (code.match(/.{1,4}/g) || []).join('-');
  const normalize = raw => String(raw || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, CODE_LEN);

  /* ---------- 读写被同步的那几把键 ---------- */
  function readKey(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    // 划重点存的是一段 HTML 字串，其余都是 JSON
    if (key === 'UEC_BIO_HL_STORE_OFFICIAL_19') return raw;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function writeKey(key, value) {
    if (value === null || value === undefined) return;
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch (e) { /* 配额满了就放弃这一把，不要拖垮整次同步 */ }
  }
  const fingerprint = v => (v === null || v === undefined) ? '' : (typeof v === 'string' ? v : JSON.stringify(v));

  /* ---------- 合并策略 ---------- */
  function mergeProgress(a, b) {
    // {科目: {章节: {题号: 'mastered' | 'wrong'}}}；答对过就是答对过，mastered 胜出
    const out = JSON.parse(JSON.stringify(a || {}));
    Object.entries(b || {}).forEach(([subject, chapters]) => {
      out[subject] = out[subject] || {};
      Object.entries(chapters || {}).forEach(([chapter, items]) => {
        out[subject][chapter] = out[subject][chapter] || {};
        Object.entries(items || {}).forEach(([idx, state]) => {
          if (out[subject][chapter][idx] !== 'mastered') out[subject][chapter][idx] = state;
        });
      });
    });
    return out;
  }

  // 两边都改过同一则笔记：两份的笔迹都留（重复的只留一笔），文字不一样就两段都留。宁可多，不要丢
  function combineNotes(x, y) {
    const [newer, older] = (x.updatedAt || 0) >= (y.updatedAt || 0) ? [x, y] : [y, x];
    const seen = new Set();
    const strokes = [...(newer.strokes || []), ...(older.strokes || [])].filter(st => {
      const k = JSON.stringify(st.pts);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const a = (newer.textNote || '').trim(), b = (older.textNote || '').trim();
    const textNote = !b || a.includes(b) ? a : !a || b.includes(a) ? b : `${a}\n\n——（另一台装置的版本）——\n${b}`;
    return Object.assign({}, newer, { strokes, textNote, updatedAt: Math.max(x.updatedAt || 0, y.updatedAt || 0) });
  }

  function mergeNotes(a, b, base, deleted) {
    // {笔记id: {strokes, textNote, createdAt, updatedAt}}
    // 只有一边改过 → 用改过的那份；两边都改过 → 合并两份（以前一律取较新的，较旧那边的内容就不见了）
    const out = {};
    const ids = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    ids.forEach(id => {
      const l = (a || {})[id], r = (b || {})[id];
      let note;
      if (!l || !r) note = l || r;
      else if ((l.updatedAt || 0) === (r.updatedAt || 0)) note = l;
      else if (base[id] !== undefined && l.updatedAt === base[id]) note = r;
      else if (base[id] !== undefined && r.updatedAt === base[id]) note = l;
      else note = combineNotes(l, r);
      // 删除之後没有再编辑过的，就是真的删了
      if (note && !(deleted[id] >= (note.updatedAt || 0))) out[id] = note;
    });
    return out;
  }

  function mergeDeleted(a, b) {
    const out = Object.assign({}, a || {});
    Object.entries(b || {}).forEach(([id, t]) => { out[id] = Math.max(out[id] || 0, t || 0); });
    const cutoff = Date.now() - NOTE_TOMBSTONE_DAYS * 86400000;
    Object.keys(out).forEach(id => { if (out[id] < cutoff) delete out[id]; });
    return out;
  }

  function mergeTour(a, b) {
    const out = Object.assign({}, a || {});
    Object.entries(b || {}).forEach(([k, v]) => { if (v) out[k] = v; });
    return out;
  }

  // 荧光笔：{科目__章节: 划线快照}。每一章分开合并；同一章两边都有才取较新的那份
  function parseHl(raw) {
    if (!raw) return {};
    try { const v = JSON.parse(raw); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch (e) { /* 旧格式 */ }
    return { __legacy: raw };
  }
  function mergeHighlights(local, remote) {
    const l = parseHl(local.value), r = parseHl(remote.value);
    const remoteNewer = (remote.ts || 0) > (local.ts || 0);
    const out = Object.assign({}, remoteNewer ? l : r, remoteNewer ? r : l);
    return JSON.stringify(out);
  }

  function mergeFeedback(a, b) {
    // {reports: [{id, sent, ...}], deleted: {id: 删除时间}}；依 id 联集。
    // 「往前走」的状态不能被另一台较旧的资料退回去：寄出、已解决、已读（点过「没问题了」）任一边有就算有，
    // 不然小精灵会再通知一次。删过的（deleted）两边都不留
    const deleted = mergeDeleted((a && a.deleted) || {}, (b && b.deleted) || {});
    const byId = new Map();
    [...((a && a.reports) || []), ...((b && b.reports) || [])].forEach(r => {
      if (!r || !r.id || deleted[r.id]) return;
      const prev = byId.get(r.id);
      if (!prev) { byId.set(r.id, r); return; }
      const merged = Object.assign({}, prev, r, {
        sent: Boolean(prev.sent || r.sent),
        acknowledged: Boolean(prev.acknowledged || r.acknowledged),
        reply: r.reply || prev.reply,
      });
      if (prev.status === 'resolved' || r.status === 'resolved') merged.status = 'resolved';
      byId.set(r.id, merged);
    });
    return { reports: Array.from(byId.values()), deleted };
  }

  function mergeReview(a, b) {
    // {题目键: {ease, interval, reps, lapses, last, due}}；同一题取最後作答的那份，
    // 因为排程反映的是「最近一次答得如何」，较旧的那份已经过时
    const out = Object.assign({}, a || {});
    Object.entries(b || {}).forEach(([k, rec]) => {
      const mine = out[k];
      if (!mine || (rec && (rec.last || 0) > (mine.last || 0))) out[k] = rec;
    });
    return out;
  }

  function mergeAttempts(a, b) {
    // 做答题 {题目键: {text, result, gradedText, at}}：同一题取较新的那份，不同题各自保留
    const out = Object.assign({}, a || {});
    Object.entries(b || {}).forEach(([k, rec]) => {
      const mine = out[k];
      if (!mine || (rec && (rec.at || 0) > (mine.at || 0))) out[k] = rec;
    });
    return out;
  }

  function mergeEntry(key, local, remote, ctx) {
    // local / remote 形如 {ts, value}；都没有就回传 null
    if (key === 'UEC_NOTES_v1' && (local || remote)) {
      // 就算只有一边有，也要套用删除纪录（另一台装置删掉的笔记，这台也要删）
      const ts = Math.max((local || {}).ts || 0, (remote || {}).ts || 0);
      return { ts, value: mergeNotes((local || {}).value, (remote || {}).value, ctx.notesBase, ctx.deleted) };
    }
    if (!local && !remote) return null;
    if (!local) return remote;
    if (!remote) return local;
    const ts = Math.max(local.ts || 0, remote.ts || 0);
    if (key === 'UEC_PROGRESS_v1') return { ts, value: mergeProgress(local.value, remote.value) };
    if (key === 'UEC_NOTES_DELETED_v1') return { ts, value: mergeDeleted(local.value, remote.value) };
    if (key === 'UEC_TOUR_v1') return { ts, value: mergeTour(local.value, remote.value) };
    if (key === 'UEC_BIO_HL_STORE_OFFICIAL_19') return { ts, value: mergeHighlights(local, remote) };
    if (key === 'UEC_FEEDBACK_v1') return { ts, value: mergeFeedback(local.value, remote.value) };
    if (key === 'UEC_REVIEW_v1') return { ts, value: mergeReview(local.value, remote.value) };
    if (key === 'UEC_SUBJ_ATTEMPTS_v1') return { ts, value: mergeAttempts(local.value, remote.value) };
    if (key === 'UEC_LAST_VISIT_v1') {
      const lv = local.value || {}, rv = remote.value || {};
      return { ts, value: (rv.ts || 0) > (lv.ts || 0) ? rv : lv };
    }
    return (remote.ts || 0) > (local.ts || 0) ? remote : local;
  }

  /* ---------- 同步本体 ---------- */
  let syncing = false;
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => { try { fn(status()); } catch (e) {} });

  function localPayload(state) {
    const now = Date.now();
    const payload = {};
    KEYS.forEach(key => {
      const value = readKey(key);
      if (value === null) return;
      const snap = state.snapshot[key] || {};
      const changed = fingerprint(value) !== snap.hash;
      payload[key] = { ts: changed ? now : (snap.ts || now), value };
    });
    return payload;
  }

  function snapshotOf(payload) {
    const snap = {};
    Object.entries(payload).forEach(([key, entry]) => {
      snap[key] = { hash: fingerprint(entry.value), ts: entry.ts };
    });
    return snap;
  }

  async function call(path, options) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
    let data = {};
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, data };
  }

  async function sync({ silent = false } = {}) {
    const state = loadState();
    if (!state.code || syncing) return { ok: false, reason: 'idle' };
    syncing = true; notify();
    try {
      let pulled = await call(`/api/sync?code=${encodeURIComponent(state.code)}`);
      if (!pulled.ok) {
        return { ok: false, reason: pulled.data.error || 'network', message: pulled.data.message };
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        const remote = pulled.data.doc || { ver: 0, payload: {} };
        const mine = localPayload(state);

        const merged = {};
        const rp = remote.payload || {};
        // 删除纪录先合并，合并笔记时才知道哪些是真的被删了
        const del = mergeEntry('UEC_NOTES_DELETED_v1', mine.UEC_NOTES_DELETED_v1, rp.UEC_NOTES_DELETED_v1, {});
        const ctx = { notesBase: state.notesBase || {}, deleted: (del && del.value) || {} };
        KEYS.forEach(key => {
          const entry = key === 'UEC_NOTES_DELETED_v1' ? del : mergeEntry(key, mine[key], rp[key], ctx);
          if (entry) merged[key] = entry;
        });

        // 合并结果写回本机，另一台装置的进度才会出现在这里
        Object.entries(merged).forEach(([key, entry]) => writeKey(key, entry.value));

        const pushed = await call('/api/sync', {
          method: 'POST',
          body: JSON.stringify({ code: state.code, baseVer: remote.ver || 0, payload: merged }),
        });

        if (pushed.ok) {
          state.baseVer = pushed.data.doc.ver;
          state.lastSyncAt = Date.now();
          state.snapshot = snapshotOf(merged);
          state.notesBase = {};
          Object.entries((merged.UEC_NOTES_v1 || {}).value || {}).forEach(([id, n]) => { state.notesBase[id] = n.updatedAt || 0; });
          saveState(state);
          // 背景同步平常不动画面；但另一台装置真的带来了新资料，数字就要跟著更新
          const changed = KEYS.some(key => merged[key] &&
            fingerprint(merged[key].value) !== fingerprint((mine[key] || {}).value));
          if ((!silent || changed) && typeof refreshAfterSync === 'function') refreshAfterSync();
          return { ok: true };
        }
        if (pushed.status === 409) {
          pulled = { ok: true, data: { doc: pushed.data.doc } };   // 别人先写了，拿最新的重来一次
          continue;
        }
        return { ok: false, reason: pushed.data.error || 'network', message: pushed.data.message };
      }
      return { ok: false, reason: 'conflict', message: '同步冲突，请再试一次。' };
    } finally {
      syncing = false; notify();
    }
  }

  function status() {
    const s = loadState();
    return { connected: Boolean(s.code), code: s.code, lastSyncAt: s.lastSyncAt, syncing, history: s.history || [] };
  }

  // 换码或断开时，把原本那串记下来。云端那份资料还在（半年没动才过期），
  // 但同步码只存在装置上，忘了就再也找不回来 —— 所以要替学生记著
  function remember(s, code) {
    if (!code) return;
    s.history = [{ code, at: Date.now() }, ...(s.history || []).filter(h => h.code !== code)].slice(0, 5);
  }

  function connect(rawCode) {
    const code = normalize(rawCode);
    if (code.length !== CODE_LEN) return { ok: false, message: `同步码应该是 ${CODE_LEN} 个字元` };
    const s = loadState();
    if (s.code && s.code !== code) remember(s, s.code);
    s.history = (s.history || []).filter(h => h.code !== code);
    s.code = code; s.baseVer = 0; s.snapshot = {}; s.notesBase = {};   // 换了码就当全新的一份，重新合并
    saveState(s); notify();
    return { ok: true };
  }

  function disconnect() {
    const s = loadState();
    remember(s, s.code);
    s.code = ''; s.baseVer = 0; s.snapshot = {}; s.notesBase = {}; s.lastSyncAt = 0;
    saveState(s); notify();
  }

  const pastCodes = () => (loadState().history || []).slice();

  function hasLocalChanges() {
    const s = loadState();
    return KEYS.some(key => {
      const v = readKey(key);
      if (v === null) return false;
      return fingerprint(v) !== ((s.snapshot[key] || {}).hash || '');
    });
  }

  // 同步链结：另一台装置打开「网址/#sync=同步码」就能接上，不用手打 20 个字。
  // 码放在 # 後面：浏览器不会把它送到伺服器，也就不会留在主机的请求纪录里。
  // 读到之後马上从网址列拿掉，免得留在书签或分享出去的网址里。
  function takeLink() {
    const m = location.hash.match(/(?:^#|&)sync=([A-Za-z0-9-]+)/);
    if (!m) return { linked: false };
    history.replaceState(null, '', location.pathname + location.search);
    const code = normalize(m[1]);
    if (code.length !== CODE_LEN) return { linked: false, message: '这个同步链结不完整，请重新复制一次。' };
    const cur = loadState().code;
    if (cur === code) return { linked: false, already: true };
    const ask = cur
      ? `这台装置已经连著另一串同步码（${pretty(cur)}）。要改接这个链结的同步码吗？\n两边的进度会合并在一起；原本那串会记在同步面板里，之後可以切回去。`
      : '要把这台装置接上这个同步链结吗？两边的做题进度、错题本和笔记会合并在一起。';
    if (!confirm(ask)) return { linked: false };
    return { linked: connect(code).ok };
  }

  window.UECSync = {
    makeCode, pretty, normalize, connect, disconnect, sync, status, takeLink, pastCodes,
    _merge: { mergeNotes, mergeDeleted, mergeHighlights, mergeTour, mergeFeedback },   // 给测试用
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    hasLocalChanges,
  };

  // 进站先拉一次；离开分页与每分钟各检查一次，有变动才真的送出
  document.addEventListener('DOMContentLoaded', () => { if (loadState().code) sync({ silent: true }); });
  // 离开分页：有变动就推；回到分页：拉一次（手机上网页一直开著，电脑做的题也要过得来），30 秒内不重复拉
  let lastPullAt = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (!loadState().code) return;
    if (document.visibilityState === 'hidden') { if (hasLocalChanges()) sync({ silent: true }); return; }
    if (Date.now() - lastPullAt < 30 * 1000) return;
    lastPullAt = Date.now();
    sync({ silent: true });
  });
  setInterval(() => { if (loadState().code && hasLocalChanges()) sync({ silent: true }); }, AUTO_EVERY_MS);
})();
