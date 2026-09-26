// 网站上的 AI 功能（做答题批改、选择题讲解）共用：限流、读题目、挑模型、呼叫 Gemini。
// 金钥只在服务器：Vercel 环境变数 GEMINI_API_KEY。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const SUBJECTS = { biology: '生物', chemistry: '化学', physics: '物理' };
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ---------- 限流：有 Upstash 就跨实例计数，没有就退回单一实例的记忆体 ----------
const memHits = new Map();
async function overLimit(req, bucket, limitPerHour) {
  const ip = String(req.headers['x-vercel-forwarded-for']
    || String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
  const hour = Math.floor(Date.now() / 3600000);
  const key = `uec:${bucket}:${crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24)}:${hour}`;
  if (store.config().ready) {
    try {
      const n = await store.command(['INCR', key]);
      if (n === 1) await store.command(['EXPIRE', key, '3700']);
      return n > limitPerHour;
    } catch (e) { /* Upstash 挂了就用记忆体顶着 */ }
  }
  if (memHits.size > 5000) memHits.clear();
  const n = (memHits.get(key) || 0) + 1;
  memHits.set(key, n);
  return n > limitPerHour;
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
  return sec && (type === 'mcq' ? sec.mcqs || [] : sec.subjectives || [])[index];
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

module.exports = { SUBJECTS, overLimit, htmlToText, findQuestion, callGemini };
