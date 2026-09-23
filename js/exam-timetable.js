/* 2026 年度第 52 届马来西亚华文独中统一考试 · 高中组考试时间表
 * 董总考试局 2026 年 6 月 29 日修订版（三页）。
 *
 * 只收理科生可以报考的科目。已排除：
 *   商科 —— 会计学(SC16/SE16)、商业学(SC14/SE14)、经济学(SY17)
 *   设计 —— 平面设计(SY25)、美术赏析(SY24)（美术 SY19 保留）
 *   电科 —— 电学原理(SY20)、电子学(SY21)、电机学(SY23)、数位逻辑(SY22)
 *   地理(SY09)；餐饮理论与实务(SY27)、厨艺理论与实务(SY26)（不少独中没开）
 * 10 月 25 日全天休息，所以表里没有那一天。
 *
 * 加科目就往 papers 里加一行：
 *   date  YYYY-MM-DD；half 只有「上午」「下午」
 *   start / end  24 小时制 HH:MM。start 取「填妥电脑卡」那一格（考生那时就要进场），end 取试卷二结束
 *   note  选填，列在时间表那一行底下
 * 同一天同一时段有多科时，首页会把它们并排写出来。
 */
window.UEC_EXAM = {
  title: '2026 年度第 52 届高中统考',
  papers: [
    { subject: '美术',           code: 'SY19',        date: '2026-10-17', half: '上午', start: '07:15', end: '13:30', note: '试卷二依组别，10:20 至 1:30 之间结束' },
    { subject: '美术',           code: 'SY19',        date: '2026-10-17', half: '下午', start: '14:30', end: '17:00', note: '试卷二甲组（素描）' },
    { subject: '英文',           code: 'SY03',        date: '2026-10-21', half: '上午', start: '08:25', end: '11:45', note: '8:10 宣读考试规则' },
    { subject: '物理',           code: 'SC12 / SE12', date: '2026-10-21', half: '下午', start: '13:55', end: '17:25' },
    { subject: '华文',           code: 'SY01',        date: '2026-10-22', half: '上午', start: '08:25', end: '12:15' },
    { subject: '数学',           code: 'SC04 / SE04', date: '2026-10-23', half: '上午', start: '08:25', end: '11:45' },
    { subject: '高级数学（Ⅱ）',  code: 'SC07 / SE07', date: '2026-10-23', half: '上午', start: '08:25', end: '11:45' },
    { subject: '马来西亚文',     code: 'SY02',        date: '2026-10-24', half: '上午', start: '08:25', end: '12:25' },
    { subject: '化学',           code: 'SC11 / SE11', date: '2026-10-24', half: '下午', start: '13:55', end: '17:15' },
    { subject: '高级数学',       code: 'SC05 / SE05', date: '2026-10-27', half: '上午', start: '08:25', end: '11:45' },
    { subject: '高级数学（Ⅰ）',  code: 'SC06 / SE06', date: '2026-10-27', half: '上午', start: '08:25', end: '11:45' },
    { subject: '历史',           code: 'SY08',        date: '2026-10-27', half: '下午', start: '13:55', end: '17:05' },
    { subject: '生物',           code: 'SC10 / SE10', date: '2026-10-28', half: '上午', start: '08:25', end: '11:35' },
    { subject: '电脑与资讯工艺', code: 'SY18',        date: '2026-10-28', half: '下午', start: '13:55', end: '16:45' },
  ],
};
