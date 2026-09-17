const {
  authConfig, sendJson, readJsonBody, safeEqual, createSessionToken, sessionCookie, sameOrigin,
} = require('./_lib/devauth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });
  }
  if (!sameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: 'bad_origin', message: '请求来源不符' });
  }

  const cfg = authConfig();
  if (!cfg.ready) {
    return sendJson(res, 503, {
      ok: false,
      error: 'not_configured',
      message: '开发者登录尚未启用：请在 Vercel 项目设置里添加 DEV_USERNAME、DEV_PASSWORD、DEV_SESSION_SECRET（至少 16 个字符）后重新部署。',
    });
  }

  const body = await readJsonBody(req);
  const userOk = safeEqual(body.username || '', cfg.username);
  const passOk = safeEqual(body.password || '', cfg.password);

  if (!(userOk && passOk)) {
    // 失败时刻意放慢，拖慢暴力猜密码
    await new Promise(resolve => setTimeout(resolve, 800));
    return sendJson(res, 401, { ok: false, error: 'invalid_credentials', message: '账号或密码不正确' });
  }

  return sendJson(
    res,
    200,
    { ok: true, username: cfg.username },
    { 'Set-Cookie': sessionCookie(createSessionToken(cfg), req) },
  );
};
