/* 2026 年度第 52 届马来西亚华文独中统一考试 · 高中组考试时间表
 * 董总考试局 2026 年 6 月 29 日修订版。
 *
 * 只收商科、美设科、电科以外的科目，已排除：
 *   商科 —— 会计学(SC16/SE16)、商业学(SC14/SE14)、经济学(SY17)
 *   美设科 —— 美术(SY19)、平面设计(SY25)、美术赏析(SY24)
 *   电科 —— 电学原理(SY20)、电子学(SY21)、电机学(SY23)、数位逻辑(SY22)
 * 10 月 25 日全天休息，所以表里没有那一天。
 *
 * 加科目就往 papers 里加一行；日期写 YYYY-MM-DD，half 只有「上午」「下午」。
 * 同一天同一时段有多科时，首页会把它们并排写出来。
 */
window.UEC_EXAM = {
  title: '2026 年度第 52 届高中统考',
  papers: [
    { subject: '英文',           code: 'SY03',        date: '2026-10-21', half: '上午' },
    { subject: '物理',           code: 'SC12 / SE12', date: '2026-10-21', half: '下午' },
    { subject: '华文',           code: 'SY01',        date: '2026-10-22', half: '上午' },
    { subject: '数学',           code: 'SC04 / SE04', date: '2026-10-23', half: '上午' },
    { subject: '高级数学（Ⅱ）',  code: 'SC07 / SE07', date: '2026-10-23', half: '上午' },
    { subject: '地理',           code: 'SY09',        date: '2026-10-23', half: '下午' },
    { subject: '马来西亚文',     code: 'SY02',        date: '2026-10-24', half: '上午' },
    { subject: '化学',           code: 'SC11 / SE11', date: '2026-10-24', half: '下午' },
    { subject: '餐饮理论与实务', code: 'SY27',        date: '2026-10-26', half: '上午' },
    { subject: '厨艺理论与实务', code: 'SY26',        date: '2026-10-26', half: '下午' },
    { subject: '高级数学',       code: 'SC05 / SE05', date: '2026-10-27', half: '上午' },
    { subject: '高级数学（Ⅰ）',  code: 'SC06 / SE06', date: '2026-10-27', half: '上午' },
    { subject: '历史',           code: 'SY08',        date: '2026-10-27', half: '下午' },
    { subject: '生物',           code: 'SC10 / SE10', date: '2026-10-28', half: '上午' },
    { subject: '电脑与资讯工艺', code: 'SY18',        date: '2026-10-28', half: '下午' },
  ],
};
