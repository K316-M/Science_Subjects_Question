/* 间隔重复复习
 * ------------------------------------------------------------
 * 只记「什麼時候該再看一次」，不碰原本的做题记录（UEC_PROGRESS_v1）——
 * 那份的资料形状被同步的合并逻辑依赖著，改它会连带弄坏跨装置同步。
 *
 * 排程用的是 SM-2 的简化版：答对就把间隔拉长、答错就打回一天并降低「容易度」。
 * 现有介面只有对／错两种结果，所以把「答对」当成 good、「答错」当成 again，
 * 这是 SM-2 在二元作答下的标准用法。
 */
(function (global) {
  'use strict';

  const REVIEW_KEY = 'UEC_REVIEW_v1';
  const DAY = 24 * 60 * 60 * 1000;

  const EASE_START = 2.3;
  const EASE_MIN = 1.3;
  const EASE_MAX = 2.8;
  const EASE_UP = 0.1;
  const EASE_DOWN = 0.25;
  const MAX_INTERVAL_DAYS = 60;   // 统考是有日期的，间隔再长没意义

  const itemKey = (subject, chapterId, mcqIdx) => `${subject}__${chapterId}__${mcqIdx}`;

  // 错题本的移出条件：答错之後，要在「不同的两天」都答对。
  // 同一天连对两次不算——刚看完答案马上答对，多半只是短期记忆。
  const WEAK_EXIT_DAYS = 2;
  const STUBBORN_LAPSES = 3;      // 错 3 次以上标「顽固」
  const localDay = t => new Date(t).toLocaleDateString('en-CA');   // YYYY-MM-DD，用本地时区

  function load() {
    try { return JSON.parse(localStorage.getItem(REVIEW_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function save(store) {
    try { localStorage.setItem(REVIEW_KEY, JSON.stringify(store)); return true; }
    catch (e) { return false; }
  }

  /* 答完一题就更新排程。回传这一题下次该在几天後出现，方便介面give回馈。 */
  function record(subject, chapterId, mcqIdx, isCorrect, now = Date.now()) {
    const store = load();
    const key = itemKey(subject, chapterId, mcqIdx);
    const prev = store[key] || { ease: EASE_START, interval: 0, reps: 0, lapses: 0 };

    let { ease, interval, reps, lapses } = prev;
    // 旧纪录没有 okDays，用 reps 近似（reps 也是「上次答错之後答对几次」）
    let okDays = prev.okDays !== undefined ? prev.okDays : Math.min(prev.reps || 0, WEAK_EXIT_DAYS);
    let lastOkDay = prev.lastOkDay || null;

    if (isCorrect) {
      reps += 1;
      ease = Math.min(EASE_MAX, ease + EASE_UP);
      // 前两次用固定的短间隔，之後才按容易度成长 —— 刚学会的东西要先巩固
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 3;
      else interval = Math.min(MAX_INTERVAL_DAYS, Math.round(interval * ease));
      const today = localDay(now);
      if (lastOkDay !== today) { okDays += 1; lastOkDay = today; }
    } else {
      reps = 0;
      lapses += 1;
      ease = Math.max(EASE_MIN, ease - EASE_DOWN);
      interval = 1;
      okDays = 0;          // 以前答对过也一样：忘了就重新收回错题本
      lastOkDay = null;
    }

    store[key] = {
      ease: Math.round(ease * 100) / 100,
      interval,
      reps,
      lapses,
      okDays,
      lastOkDay,
      last: now,
      due: now + interval * DAY,
    };
    save(store);
    return interval;
  }

  /* 今天该复习哪些题：扫过该科所有章节，挑出已到期的 */
  function dueList(subject, sections, now = Date.now()) {
    const store = load();
    const out = [];
    (sections || []).forEach((sec, chapterIdx) => {
      (sec.mcqs || []).forEach((q, mcqIdx) => {
        const rec = store[itemKey(subject, sec.id, mcqIdx)];
        if (!rec || rec.due > now) return;
        out.push({
          chapterIdx,
          mcqIdx,
          chapterTitle: sec.title || `第 ${chapterIdx + 1} 章`,
          question: q.q || '',
          overdueDays: Math.floor((now - rec.due) / DAY),
          lapses: rec.lapses || 0,
        });
      });
    });
    // 拖得越久、错得越多的排前面
    out.sort((a, b) => (b.overdueDays - a.overdueDays) || (b.lapses - a.lapses));
    return out;
  }

  /* 这一题算不算「还没掌握」：答错过，而且答错之後还没在不同的两天都答对 */
  function isWeak(rec) {
    if (!rec || !rec.lapses) return false;
    const ok = rec.okDays !== undefined ? rec.okDays : Math.min(rec.reps || 0, WEAK_EXIT_DAYS);
    return ok < WEAK_EXIT_DAYS;
  }

  /* 错题本：该科所有还没掌握的题，顽固的（错 3 次以上）排前面 */
  function weakList(subject, sections) {
    const store = load();
    const out = [];
    (sections || []).forEach((sec, chapterIdx) => {
      (sec.mcqs || []).forEach((q, mcqIdx) => {
        const rec = store[itemKey(subject, sec.id, mcqIdx)];
        if (!isWeak(rec)) return;
        const okDays = rec.okDays !== undefined ? rec.okDays : Math.min(rec.reps || 0, WEAK_EXIT_DAYS);
        out.push({
          chapterIdx, mcqIdx,
          chapterTitle: sec.title || `第 ${chapterIdx + 1} 章`,
          question: q.q || '',
          lapses: rec.lapses,
          okDays,
          stubborn: rec.lapses >= STUBBORN_LAPSES,
        });
      });
    });
    return out;
  }

  /* 某一题是否有复习纪录（错题本要知道「这题是不是在复习功能上线前答的」） */
  function hasRecord(subject, chapterId, mcqIdx) {
    return Boolean(load()[itemKey(subject, chapterId, mcqIdx)]);
  }
  function isWeakItem(subject, chapterId, mcqIdx) {
    return isWeak(load()[itemKey(subject, chapterId, mcqIdx)]);
  }

  function dueCount(subject, sections, now = Date.now()) {
    return dueList(subject, sections, now).length;
  }

  /* 还没到期的下一题在什麼时候 —— 没东西可复习时用来告诉使用者「下次是什麼时候」 */
  function nextDueAt(subject, sections, now = Date.now()) {
    const store = load();
    let soonest = Infinity;
    (sections || []).forEach(sec => {
      (sec.mcqs || []).forEach((q, mcqIdx) => {
        const rec = store[itemKey(subject, sec.id, mcqIdx)];
        if (rec && rec.due > now && rec.due < soonest) soonest = rec.due;
      });
    });
    return soonest === Infinity ? null : soonest;
  }

  function describeInterval(days) {
    if (days <= 1) return '明天再看一次';
    if (days < 7) return `${days} 天后再看`;
    if (days < 30) return `约 ${Math.round(days / 7)} 周后再看`;
    return `约 ${Math.round(days / 30)} 个月后再看`;
  }

  global.UECReview = {
    REVIEW_KEY, WEAK_EXIT_DAYS, STUBBORN_LAPSES,
    record, dueList, dueCount, nextDueAt, describeInterval, itemKey,
    weakList, isWeakItem, hasRecord,
  };
})(typeof window !== 'undefined' ? window : globalThis);
