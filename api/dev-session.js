const { authConfig, setupStatus, publishingConfig, verifySession, sendJson } = require('./_lib/devauth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET' });
  }
  const session = verifySession(req);
  const cfg = authConfig();
  const pub = publishingConfig();
  return sendJson(res, 200, {
    ok: true,
    configured: cfg.ready,
    authenticated: Boolean(session),
    username: session ? session.username : null,
    expiresAt: session ? session.exp * 1000 : null,
    // 尚未配置时才回报「哪个变量缺失」，方便自查；只回报有无，不回报内容。
    // 配置好之后这一栏就消失，不会对外透露任何账号信息。
    setup: cfg.ready ? null : setupStatus(),
    // 只告诉前端「有没有配置」，令牌本身永远不下发
    publishing: session ? { enabled: Boolean(pub.token), repo: pub.repo, branch: pub.branch } : null,
  });
};
