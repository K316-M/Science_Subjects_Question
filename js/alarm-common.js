/* 统考闹钟：网站（js/exam-alarm.js，开着网站时自己响）与伺服器（api/alarm-tick.js，网站关着时推播）共用的部分。
 * 两边都从这里算「离开考还有多久」、组出通知的文字，说的话才会一模一样。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UECAlarmCommon = api;
})(this, function () {
  // 统考在马来西亚考，时间表上的时间都是马来西亚时间；伺服器跑在 UTC，所以明写时区
  const EXAM_TZ = '+08:00';
  const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // 这一科第一场的进场时间（js/exam-timetable.js 每一场的第一格）。美术考上下午两场，算上午那场
  function examStart(papers, subject) {
    const times = (papers || []).filter(p => p.subject === subject)
      .map(p => Date.parse(`${p.date}T${p.start}:00${EXAM_TZ}`)).filter(Number.isFinite);
    return times.length ? Math.min(...times) : null;
  }

  // 离开考还有多久：一天以上说「N 天 M 小时」（小时四舍五入），不到一天说「N 小时 M 分钟」，不到一小时说「M 分钟」
  function countdown(ms) {
    const mins = Math.max(0, Math.round(ms / 60000));
    if (mins >= 1440) {
      let d = Math.floor(mins / 1440), h = Math.round((mins % 1440) / 60);
      if (h === 24) { d += 1; h = 0; }
      return h ? `${d} 天 ${h} 小时` : `${d} 天`;
    }
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h) return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
    return `${Math.max(1, m)} 分钟`;
  }

  // 通知的标题与内文。at＝闹钟设定的那一刻（伺服器晚几十秒送出，还是照设定的时间算，才不会少算一小时）
  function message(papers, subject, at) {
    const first = (papers || []).filter(p => p.subject === subject)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
    const start = examStart(papers, subject);
    if (!first || !start) return null;
    const [y, m, d] = first.date.split('-').map(Number);
    const [hh, mm] = first.start.split(':').map(Number);
    const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return {
      title: `${subject}还有 ${countdown(start - at)}就要考了~`,
      body: `${m} 月 ${d} 日（${weekday}）${first.half} ${hh > 12 ? hh - 12 : hh}:${String(mm).padStart(2, '0')} 进场`,
    };
  }

  return { EXAM_TZ, examStart, countdown, message };
});
