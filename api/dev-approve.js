// 审题：把待审区（papers/pending_approval.json）里的题目采纳进正式题库，或直接退回。
// 这是整条流水线最後一哩 —— 在此之前，AI 产出的题目永远到不了学生手上。
const { publishingConfig, verifySession, sendJson, readJsonBody, sameOrigin } = require('./_lib/devauth');

const PENDING_PATH = 'papers/pending_approval.json';
const SUBJECTS = ['biology', 'chemistry', 'physics'];
const bankPath = subject => `papers/${subject}_question_bank.json`;

class InputError extends Error {}

class GitHubError extends Error {
  constructor(status, detail) { super(`GitHub API ${status}`); this.status = status; this.detail = detail; }
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'uec-science-dev-console',
  };
}

async function readFile(pub, filePath) {
  const url = `https://api.github.com/repos/${pub.repo}/contents/${filePath}?ref=${encodeURIComponent(pub.branch)}`;
  const res = await fetch(url, { headers: ghHeaders(pub.token) });
  if (res.status === 404) return { sha: null, json: null };
  if (!res.ok) throw new GitHubError(res.status, await res.text());
  const data = await res.json();
  try {
    return { sha: data.sha, json: JSON.parse(Buffer.from(data.content || '', 'base64').toString('utf8')) };
  } catch (e) {
    throw new InputError(`${filePath} 不是合法的 JSON，请先修好再采纳。`);
  }
}

async function writeFile(pub, filePath, json, sha, message) {
  const res = await fetch(`https://api.github.com/repos/${pub.repo}/contents/${filePath}`, {
    method: 'PUT',
    headers: { ...ghHeaders(pub.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(json, null, 2) + '\n', 'utf8').toString('base64'),
      branch: pub.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new GitHubError(res.status, await res.text());
}

const normalize = t => String(t || '').replace(/\s+/g, '').trim();

// 只挑认得的栏位写进题库，待审区里的其余栏位（flags、来源、时间戳）不带进正式资料
function toBankEntry(item) {
  if (item.type === 'subjective') {
    const question = String(item.question || '').trim();
    if (!question) throw new InputError('这题没有题干，不能采纳。');
    return { question, answer: String(item.answer || '').trim() };
  }
  const q = String(item.q || '').trim();
  const options = Array.isArray(item.options) ? item.options.map(o => String(o).trim()) : [];
  if (!q) throw new InputError('这题没有题干，不能采纳。');
  if (options.length !== 4) throw new InputError('选项不是 4 个，不能采纳。');
  if (!Number.isInteger(item.answer) || item.answer < 0 || item.answer > 3) {
    throw new InputError('答案序号不在 0–3 之间，不能采纳。');
  }
  const entry = { q, options, answer: item.answer, explanation: String(item.explanation || '').trim() };
  if (item.image) entry.image = String(item.image);
  return entry;
}

module.exports = async (req, res) => {
  if (!verifySession(req)) {
    return sendJson(res, 401, { ok: false, error: 'unauthenticated', message: '请先登录开发者工作台' });
  }
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });
  }
  if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'bad_origin' });

  const pub = publishingConfig();
  if (!pub.token) {
    return sendJson(res, 501, {
      ok: false, error: 'publishing_not_configured',
      message: '尚未配置一键发布：请在 Vercel 环境变数里加入 GITHUB_TOKEN。',
    });
  }

  try {
    const body = await readJsonBody(req);
    const action = body.action === 'reject' ? 'reject' : 'adopt';

    const pending = await readFile(pub, PENDING_PATH);
    const items = (pending.json && Array.isArray(pending.json.items)) ? pending.json.items : [];
    if (!items.length) throw new InputError('待审区目前是空的。');

    const requested = action === 'adopt'
      ? (Array.isArray(body.items) ? body.items : [])
      : (Array.isArray(body.ids) ? body.ids.map(id => ({ id })) : []);
    if (!requested.length) throw new InputError('没有指定要处理的题目。');

    const byId = new Map(items.map(it => [it.id, it]));
    const handled = [];
    const skipped = [];

    if (action === 'adopt') {
      // 依科目分组，每一科的题库只读写一次
      const groups = new Map();
      for (const ask of requested) {
        const item = byId.get(ask.id);
        if (!item) { skipped.push({ id: ask.id, why: '待审区里找不到这一题' }); continue; }
        const subject = SUBJECTS.includes(item.subject) ? item.subject : null;
        if (!subject) { skipped.push({ id: ask.id, why: '科目不明' }); continue; }
        if (!groups.has(subject)) groups.set(subject, []);
        groups.get(subject).push({ item, chapterId: String(ask.chapterId || item.chapter_id || '') });
      }

      for (const [subject, rows] of groups) {
        const bank = await readFile(pub, bankPath(subject));
        if (!bank.json || !Array.isArray(bank.json.sections)) {
          rows.forEach(r => skipped.push({ id: r.item.id, why: `${subject} 的题库读不到或格式不对` }));
          continue;
        }
        const sections = bank.json.sections;
        let changed = 0;

        for (const { item, chapterId } of rows) {
          const section = sections.find(s => s.id === chapterId);
          if (!section) { skipped.push({ id: item.id, why: '找不到对应章节，请先在下拉选单指定' }); continue; }

          let entry;
          try { entry = toBankEntry(item); }
          catch (e) { skipped.push({ id: item.id, why: e.message }); continue; }

          const list = item.type === 'subjective'
            ? (section.subjectives = section.subjectives || [])
            : (section.mcqs = section.mcqs || []);

          // 去重：重复按采纳、或上一次只写成功一半，都不该把同一题塞两遍
          const key = normalize(entry.q || entry.question);
          if (list.some(x => normalize(x.q || x.question) === key)) {
            handled.push(item.id);     // 已经在题库里了，当作成功，从待审区移除
            continue;
          }
          list.push(entry);
          handled.push(item.id);
          changed += 1;
        }

        if (changed) {
          await writeFile(pub, bankPath(subject), bank.json, bank.sha,
            `📥 采纳 ${changed} 道题目进 ${subject} 题库`);
        }
      }
    } else {
      requested.forEach(ask => {
        if (byId.has(ask.id)) handled.push(ask.id);
        else skipped.push({ id: ask.id, why: '待审区里找不到这一题' });
      });
    }

    if (handled.length) {
      // 题库先写、待审区後写。万一这一步失败，题目会留在待审区，
      // 但上面的去重会让再按一次采纳变成安全的无动作。
      const keep = items.filter(it => !handled.includes(it.id));
      await writeFile(pub, PENDING_PATH, { ...pending.json, items: keep }, pending.sha,
        action === 'adopt' ? `✅ 待审区移除已采纳的 ${handled.length} 题` : `🗑️ 退回 ${handled.length} 道待审题目`);
    }

    return sendJson(res, 200, { ok: true, action, handled: handled.length, skipped });
  } catch (err) {
    if (err instanceof InputError) {
      return sendJson(res, 400, { ok: false, error: 'bad_request', message: err.message });
    }
    if (err instanceof GitHubError) {
      const map = {
        401: 'GITHUB_TOKEN 无效或已过期，请重新产生。',
        403: 'GITHUB_TOKEN 权限不足：需要对该仓库的 Contents「Read and write」权限。',
        404: '找不到仓库或档案（检查 GITHUB_REPO）。',
        409: '档案刚被别处改动，请重试一次。',
        422: '档案刚被别处改动，请重试一次。',
      };
      return sendJson(res, 502, { ok: false, error: 'github_error', message: map[err.status] || `GitHub 返回错误（${err.status}）。` });
    }
    console.error('dev-approve failed:', err);
    return sendJson(res, 500, { ok: false, error: 'server_error', message: '服务器处理失败，请稍后再试。' });
  }
};
