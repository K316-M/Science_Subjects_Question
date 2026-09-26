// 选择题「AI 讲给我听」：学生作答之後，依他选的选项讲清楚为什么对、为什么错。
// 题目、选项、正解与题库解析都由服务器从题库读；浏览器只送「第几题、选了哪个」。
// 每个 IP 每小时限 30 次（和批改分开计）。
const { sendJson, readJsonBody, sameOrigin } = require('./_lib/devauth');
const { SUBJECTS, overLimit, htmlToText, findQuestion, callGemini } = require('./_lib/ai');

const LIMIT_PER_HOUR = 30;
const LETTERS = 'ABCD';

function buildPrompt(subjectLabel, item, chosen) {
  const options = (item.options || []).map(o => htmlToText(o)).join('\n');
  const right = LETTERS[item.answer];
  const picked = LETTERS[chosen];
  const correct = chosen === item.answer;
  return `你是马来西亚华文独中统考（UEC 高中）${subjectLabel}科老师，用简体中文、对高中生说话的口吻，讲解一道选择题。

【题目】
${htmlToText(item.q)}
${options}

【正确答案】${right}
【题库原本的解析】${htmlToText(item.explanation) || '（无）'}
【学生选了】${picked}（${correct ? '答对' : '答错'}）

要求：
1. 先用一两句说清楚这题在考什么概念。
2. ${correct ? '说明为什么答案是 ' + right + '，再逐一点出其他选项错在哪（一句一个）。'
    : '先讲学生选的 ' + picked + ' 为什么不对、最可能是哪个观念弄混了，再讲为什么 ' + right + ' 才对。'}
3. 最後给一个好记的小技巧或口诀，帮他下次不会再错。
4. 总长不超过 220 字；不要用 Markdown 符号；讲的内容必须和正确答案 ${right} 一致，不可以推翻它。

只回传 JSON：{"concept":"考点（一句）","why":"讲解（可分成几句）","tip":"小技巧（一句）"}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });
  if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'bad_origin' });
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) return sendJson(res, 501, { ok: false, error: 'not_configured', message: 'AI 讲解还没开启。' });

  const body = await readJsonBody(req);
  const subject = SUBJECTS[body.subject] ? body.subject : null;
  const chosen = Number(body.chosen);
  if (!subject || !Number.isInteger(chosen) || chosen < 0 || chosen > 3) {
    return sendJson(res, 400, { ok: false, error: 'bad_request', message: '资料不完整，请重新整理页面。' });
  }
  let item;
  try {
    item = findQuestion(subject, String(body.chapterId || ''), Number(body.index), 'mcq');
  } catch (e) {
    item = null;
  }
  if (!item || !Array.isArray(item.options) || !Number.isInteger(item.answer)) {
    return sendJson(res, 404, { ok: false, error: 'not_found', message: '找不到这一题，请重新整理页面。' });
  }
  if (await overLimit(req, 'explain', LIMIT_PER_HOUR)) {
    return sendJson(res, 429, { ok: false, error: 'rate_limited', message: `这一小时已经请 AI 讲解 ${LIMIT_PER_HOUR} 次了，先看看题库的解析，一小时後再试。` });
  }

  try {
    const { model, json } = await callGemini(key, buildPrompt(SUBJECTS[subject], item, chosen));
    const clip = (v, n) => String(v || '').replace(/[*#`]/g, '').trim().slice(0, n);
    const result = { concept: clip(json.concept, 80), why: clip(json.why, 400), tip: clip(json.tip, 120) };
    if (!result.why) throw new Error('empty');
    return sendJson(res, 200, { ok: true, result, model });
  } catch (e) {
    console.error('explain failed:', e && e.message);
    return sendJson(res, 502, { ok: false, error: 'ai_error', message: 'AI 暂时讲解不了，请稍後再试。' });
  }
};
