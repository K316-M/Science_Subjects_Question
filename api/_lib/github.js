// 透过 GitHub API 读写仓库。
// 一次操作要改的档案（题库、待审区、配图）打包成「一个 commit」送出：
//   - 不会有「题库写进去了、待审区没删掉」的半套状态
//   - 一次采纳只触发一次 Vercel 部署、一次题库巡检（以前是两次）
const { sendJson } = require('./devauth');
const { InputError } = require('./questions');

class GitHubError extends Error {
  constructor(status, detail) {
    super(`GitHub API ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

function ghHeaders(token, accept = 'application/vnd.github+json') {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'uec-science-dev-console',
  };
}

async function gh(pub, path, body) {
  const res = await fetch(`https://api.github.com/repos/${pub.repo}${path}`, {
    method: body ? (body.method || 'POST') : 'GET',
    headers: { ...ghHeaders(pub.token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body.data) : undefined,
  });
  if (!res.ok) throw new GitHubError(res.status, await res.text());
  return res.json();
}

// 记下分支现在指到哪个 commit；之後的读取都钉在这个 commit 上，
// 送出时若分支已经被别人往前推，GitHub 会拒绝（不会盖掉别人的改动）
async function snapshot(pub) {
  const ref = await gh(pub, `/git/ref/heads/${pub.branch}`);
  const commit = await gh(pub, `/git/commits/${ref.object.sha}`);
  return { head: ref.object.sha, tree: commit.tree.sha };
}

// 用 raw 格式读：contents API 的 JSON 格式超过 1MB 就不给内容，题库迟早会超过
async function readJson(pub, snap, filePath) {
  const res = await fetch(
    `https://api.github.com/repos/${pub.repo}/contents/${filePath}?ref=${snap.head}`,
    { headers: ghHeaders(pub.token, 'application/vnd.github.raw+json') }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(res.status, await res.text());
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new InputError(`${filePath} 不是合法的 JSON，请先修好再操作。`);
  }
}

// files：[{ path, json }] 或 [{ path, base64 }]（配图）
async function commitFiles(pub, snap, files, message) {
  const tree = [];
  for (const f of files) {
    if (f.base64 !== undefined) {
      const blob = await gh(pub, '/git/blobs', { data: { content: f.base64, encoding: 'base64' } });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    } else {
      tree.push({ path: f.path, mode: '100644', type: 'blob', content: JSON.stringify(f.json, null, 2) + '\n' });
    }
  }
  const newTree = await gh(pub, '/git/trees', { data: { base_tree: snap.tree, tree } });
  const commit = await gh(pub, '/git/commits', { data: { message, tree: newTree.sha, parents: [snap.head] } });
  await gh(pub, `/git/refs/heads/${pub.branch}`, { method: 'PATCH', data: { sha: commit.sha, force: false } });
}

// 两支接口共用的错误回应
function sendError(res, err, where) {
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
    return sendJson(res, 502, {
      ok: false, error: 'github_error', message: map[err.status] || `GitHub 返回错误（${err.status}）。`,
    });
  }
  console.error(`${where} failed:`, err);
  return sendJson(res, 500, { ok: false, error: 'server_error', message: '服务器处理失败，请稍后再试。' });
}

module.exports = { GitHubError, snapshot, readJson, commitFiles, sendError };
