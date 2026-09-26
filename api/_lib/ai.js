// 网站上的 AI 功能（做答题批改、选择题讲解）共用：限流、读题目、挑模型、呼叫 Gemini。
// 金钥只在服务器：Vercel 环境变数 GEMINI_API_KEY。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const SUBJECTS = { biology: '生物', chemistry: '化学', physics: '物理' };
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ---------- 限流：有 Upstash 就跨实例计数，没有就退回单一实例的记忆体 ----------
// 每台装置各算各的（浏览器送来的随机装置码）：同一所学校连同一个 Wi-Fi，对外是同一个 IP，
// 只按 IP 算的话全校共用一份额度。装置码可以伪造，所以同一个 IP 另有一个较高的总上限兜底。
const memHits = new Map();
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24);
async function bump(key, by) {
  if (store.config().ready) {
    try {
      const n = await store.command([by > 0 ? 'INCR' : 'DECR', key]);
      if (n === 1) await store.command(['EXPIRE', key, '3700']);
      return n;
    } catch (e) { /* Upstash 挂了就用记忆体顶着 */ }
  }
  if (memHits.size > 5000) memHits.clear();
  const n = (memHits.get(key) || 0) + by;
  memHits.set(key, n);
  return n;
}

// 回传 { over, shared, left, resetMin, refund }。over 时 shared 表示是同一个网络的总上限到了。
// refund()：AI 这次没答出来，把这一次还给学生
async function useQuota(req, bucket, perDevice, perNetwork) {
  const ip = String(req.headers['x-vercel-forwarded-for']
    || String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
  const device = String(req.headers['x-uec-device'] || '');
  const now = Date.now();
  const hour = Math.floor(now / 3600000);
  const resetMin = Math.max(1, Math.ceil((3600000 - (now % 3600000)) / 60000));
  const devKey = `uec:${bucket}:d:${hash(/^[A-Za-z0-9_-]{16,64}$/.test(device) ? device : 'ip:' + ip)}:${hour}`;
  const netKey = `uec:${bucket}:ip:${hash(ip)}:${hour}`;
  const n = await bump(devKey, 1);
  if (n > perDevice) return { over: true, shared: false, left: 0, resetMin };
  if (await bump(netKey, 1) > perNetwork) {
    await bump(devKey, -1);
    return { over: true, shared: true, left: perDevice - n + 1, resetMin };
  }
  return {
    over: false, shared: false, left: perDevice - n, resetMin,
    refund: async () => { await bump(devKey, -1); await bump(netKey, -1); },
  };
}

// ---------- 题目 ----------
const htmlToText = html => String(html || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n').trim();

// type：'subjective' 或 'mcq'。题目一律从部署上去的题库读，不收浏览器送来的内容
function findQuestion(subject, chapterId, index, type = 'subjective') {
  const file = path.join(process.cwd(), 'papers', `${subject}_question_bank.json`);
  const bank = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sec = (bank.sections || []).find(s => s.id === chapterId);
  const item = sec && (type === 'mcq' ? sec.mcqs || [] : sec.subjectives || [])[index];
  return item && !item.hidden ? item : undefined;   // 在 /dev 下架的题不批改、不讲解
}

// ---------- 模型：批改要等得起，所以新版本的 flash 优先（录题那边才是 pro 优先） ----------
const TIER = { flash: 0, 'flash-lite': 1, pro: 2 };
const MODEL_RE = /^gemini-(\d+(?:\.\d+)?)-(pro|flash-lite|flash)(?:-(latest|\d{3}|preview[\w.-]*|exp[\w.-]*))?$/;
let models = null;
async function rankedModels(key) {
  if (models) return models;
  const res = await fetch(`${API_BASE}/models?key=${key}&pageSize=200`);
  if (!res.ok) throw new Error(`models ${res.status}`);
  const names = ((await res.json()).models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace('models/', ''));
  const ver = v => v.split('.').map(Number);
  models = names.map(n => [n, MODEL_RE.exec(n)]).filter(([, m]) => m).sort(([an, a], [bn, b]) => {
    const [va, vb] = [ver(a[1]), ver(b[1])];
    for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((va[i] || 0) !== (vb[i] || 0)) return (vb[i] || 0) - (va[i] || 0);
    const unstable = m => (m[3] && /^(preview|exp)/.test(m[3]) ? 1 : 0);
    return TIER[a[2]] - TIER[b[2]] || unstable(a) - unstable(b) || an.localeCompare(bn);
  }).map(([n]) => n);
  return models;
}

async function callGemini(key, prompt) {
  let last = null;
  for (const model of (await rankedModels(key)).slice(0, 4)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 22000);
    try {
      const res = await fetch(`${API_BASE}/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        last = new Error(`${model} ${res.status}`);
        if ([404, 429, 500, 503].includes(res.status)) continue;   // 下架、额度用完、忙碌：换下一个
        throw last;
      }
      const data = await res.json();
      const text = data.candidates && data.candidates[0] && data.candidates[0].content
        && data.candidates[0].content.parts && data.candidates[0].content.parts[0].text;
      return { model, json: JSON.parse(String(text || '').replace(/^```(json)?|```$/gm, '').trim()) };
    } catch (e) {
      last = e;
      if (e.name === 'AbortError') continue;
      if (e instanceof SyntaxError) continue;       // 回的不是 JSON：换一个再试
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last || new Error('no model');
}

// ---------- 选择题讲解的共用快取 ----------
// 同一题、选同一个答案，全班拿同一份讲解：第一个人问过之後，其他人不扣次数、也不再呼叫 Gemini。
// 键里带题目内容的杂凑：在 /dev 改过题干、选项、答案或解析，旧讲解自动作废。
const EXPLAIN_TTL_SECONDS = 180 * 24 * 60 * 60;
function explainKey(subject, chapterId, index, chosen, item) {
  const content = JSON.stringify([item.q, item.options, item.answer, item.explanation || '']);
  return `uec:explain:v1:${subject}:${chapterId}:${index}:${chosen}:${hash(content)}`;
}
async function readExplain(key) {
  if (!store.config().ready) return null;
  try {
    const raw = await store.command(['GET', key]);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }   // 快取坏了就当没有，照常问 AI
}
async function saveExplain(key, result) {
  if (!store.config().ready) return;
  try { await store.command(['SET', key, JSON.stringify(result), 'EX', String(EXPLAIN_TTL_SECONDS)]); } catch (e) { /* 存不进去下次再问一次而已 */ }
}
// /dev 清掉某一题四个选项的讲解（讲错了，要 AI 重讲）
async function clearExplain(subject, chapterId, index, item) {
  if (!store.config().ready) return null;
  const keys = [0, 1, 2, 3].map(c => explainKey(subject, chapterId, index, c, item));
  return store.command(['DEL', ...keys]);
}

module.exports = { SUBJECTS, useQuota, htmlToText, findQuestion, callGemini, explainKey, readExplain, saveExplain, clearExplain };
