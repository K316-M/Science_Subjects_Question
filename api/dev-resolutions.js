// 读取／发布／撤回申诉处理结果：通过 GitHub Contents API 直接改仓库里的
// data/resolved_issues.json，推送后 Vercel 自动重新部署，学生下次开站就能看到小精灵。
const {
  publishingConfig, verifySession, sendJson, readJsonBody, sameOrigin,
} = require('./_lib/devauth');

const FILE_PATH = 'data/resolved_issues.json';
const VIEWS = ['viewSubjects', 'viewStudy', 'viewNotes', 'viewArchive', 'viewFeedback'];
const SUBJECTS = ['biology', 'chemistry', 'physics'];
const SUB_MODES = ['mcq', 'subj', 'wrong'];

class GitHubError extends Error {
  constructor(status, detail) {
    super(`GitHub API ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'uec-science-dev-console',
  };
}

function contentsUrl(pub) {
  return `https://api.github.com/repos/${pub.repo}/contents/${FILE_PATH}`;
}

async function readRemote(pub) {
  const res = await fetch(`${contentsUrl(pub)}?ref=${encodeURIComponent(pub.branch)}`, { headers: ghHeaders(pub.token) });
  if (res.status === 404) return { sha: null, json: { resolutions: [] } };
  if (!res.ok) throw new GitHubError(res.status, await res.text());
  const data = await res.json();
  const text = Buffer.from(data.content || '', 'base64').toString('utf8');
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = { resolutions: [] };
  }
  if (!Array.isArray(json.resolutions)) json.resolutions = [];
  return { sha: data.sha, json };
}

async function writeRemote(pub, json, sha, message) {
  const res = await fetch(contentsUrl(pub), {
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
  const data = await res.json();
  return data.commit ? { sha: data.commit.sha, url: data.commit.html_url } : {};
}

function sanitizeEntry(raw) {
  const reportId = String((raw && raw.reportId) || '');
  if (!/^fb_[a-z0-9]{4,40}$/.test(reportId)) throw new Error('问题编号格式不对（应形如 fb_xxxx）');
  const summary = String((raw && raw.summary) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!summary) throw new Error('请填写处理说明');

  const t = (raw && raw.target) || {};
  const target = { view: VIEWS.includes(t.view) ? t.view : 'viewSubjects' };
  if (target.view === 'viewStudy') {
    const idx = Number(t.chapterIdx);
    target.subject = SUBJECTS.includes(t.subject) ? t.subject : 'biology';
    target.chapterIdx = Number.isInteger(idx) && idx >= 0 && idx < 100 ? idx : 0;
    target.subMode = SUB_MODES.includes(t.subMode) ? t.subMode : 'mcq';
  }
  return { reportId, summary, resolvedAt: new Date().toISOString().slice(0, 10), target };
}

function explainGitHubError(err) {
  if (err.status === 401) return 'GITHUB_TOKEN 无效或已过期，请重新生成。';
  if (err.status === 403) return 'GITHUB_TOKEN 权限不足：需要对该仓库的 Contents「Read and write」权限。';
  if (err.status === 404) return '找不到仓库，或令牌没有访问这个仓库的权限（检查 GITHUB_REPO）。';
  if (err.status === 409 || err.status === 422) return '仓库文件刚被别处改动，请重试一次。';
  return `GitHub 返回错误（${err.status}）。`;
}

module.exports = async (req, res) => {
  if (!verifySession(req)) {
    return sendJson(res, 401, { ok: false, error: 'unauthenticated', message: '请先登录开发者工作台' });
  }
  const pub = publishingConfig();
  if (!pub.token) {
    return sendJson(res, 501, {
      ok: false,
      error: 'publishing_not_configured',
      message: '尚未配置一键发布：请在 Vercel 环境变量里添加 GITHUB_TOKEN。',
    });
  }

  try {
    if (req.method === 'GET') {
      const { json } = await readRemote(pub);
      return sendJson(res, 200, { ok: true, resolutions: json.resolutions });
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET, POST' });
    }
    if (!sameOrigin(req)) {
      return sendJson(res, 403, { ok: false, error: 'bad_origin' });
    }

    const body = await readJsonBody(req);
    let entry = null;
    let reportId = '';
    if (body.action === 'publish') {
      entry = sanitizeEntry(body.entry);
    } else if (body.action === 'withdraw') {
      reportId = String(body.reportId || '');
      if (!/^fb_[a-z0-9]{4,40}$/.test(reportId)) throw new Error('问题编号格式不对');
    } else {
      return sendJson(res, 400, { ok: false, error: 'bad_action', message: '未知操作' });
    }

    // 读 → 改 → 写；若刚好有别人同时改了文件（sha 冲突），重新读一次再试
    for (let attempt = 0; attempt < 3; attempt++) {
      const { sha, json } = await readRemote(pub);
      if (entry) {
        json.resolutions = json.resolutions.filter(r => r.reportId !== entry.reportId);
        json.resolutions.push(entry);
      } else {
        const before = json.resolutions.length;
        json.resolutions = json.resolutions.filter(r => r.reportId !== reportId);
        if (json.resolutions.length === before) {
          return sendJson(res, 404, { ok: false, error: 'not_found', message: '没有找到这条处理结果' });
        }
      }
      const message = entry
        ? `🧚 发布申诉处理结果 ${entry.reportId}：${entry.summary}`
        : `↩️ 撤回申诉处理结果 ${reportId}`;
      try {
        const commit = await writeRemote(pub, json, sha, message);
        return sendJson(res, 200, { ok: true, resolutions: json.resolutions, commit });
      } catch (err) {
        if (err instanceof GitHubError && (err.status === 409 || err.status === 422) && attempt < 2) continue;
        throw err;
      }
    }
    return sendJson(res, 409, { ok: false, error: 'conflict', message: '文件持续冲突，请稍后再试' });
  } catch (err) {
    if (err instanceof GitHubError) {
      return sendJson(res, 502, { ok: false, error: 'github_error', message: explainGitHubError(err) });
    }
    return sendJson(res, 400, { ok: false, error: 'bad_request', message: err.message });
  }
};
