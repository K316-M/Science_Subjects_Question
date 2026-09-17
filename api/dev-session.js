const { authConfig, publishingConfig, verifySession, sendJson } = require('./_lib/devauth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET' });
  }
  const session = verifySession(req);
  const pub = publishingConfig();
  return sendJson(res, 200, {
    ok: true,
    configured: authConfig().ready,
    authenticated: Boolean(session),
    username: session ? session.username : null,
    expiresAt: session ? session.exp * 1000 : null,
    // 只告诉前端「有没有配置」，令牌本身永远不下发
    publishing: session ? { enabled: Boolean(pub.token), repo: pub.repo, branch: pub.branch } : null,
  });
};
