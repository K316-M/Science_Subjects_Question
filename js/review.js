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

    if (isCorrect) {
      reps += 1;
      ease = Math.min(EASE_MAX, ease + EASE_UP);
      // 前两次用固定的短间隔，之後才按容易度成长 —— 刚学会的东西要先巩固
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 3;
      else interval = Math.min(MAX_INTERVAL_DAYS, Math.round(interval * ease));
    } else {
      reps = 0;
      lapses += 1;
      ease = Math.max(EASE_MIN, ease - EASE_DOWN);
      interval = 1;
    }

    store[key] = {
      ease: Math.round(ease * 100) / 100,
      interval,
      reps,
      lapses,
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
    if (days < 7) return `${days} 天後再看`;
    if (days < 30) return `约 ${Math.round(days / 7)} 周後再看`;
    return `约 ${Math.round(days / 30)} 个月後再看`;
  }

  global.UECReview = { REVIEW_KEY, record, dueList, dueCount, nextDueAt, describeInterval, itemKey };
})(typeof window !== 'undefined' ? window : globalThis);
