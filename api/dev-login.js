const {
  authConfig, setupStatus, sendJson, readJsonBody, safeEqual, createSessionToken,
  sessionCookie, sameOrigin, loginGate, noteLoginFailure, clearLoginFailures,
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
      message: '开发者登录尚未启用：请在 Vercel 项目（不是 GitHub）的 Settings → Environment Variables 添加 DEV_USERNAME、DEV_PASSWORD、DEV_SESSION_SECRET，然后重新部署。',
      setup: setupStatus(),
    });
  }

  const gate = loginGate(req);
  if (gate.blocked) {
    return sendJson(res, 429, {
      ok: false,
      error: 'too_many_attempts',
      message: `尝试次数过多，请在 ${Math.ceil(gate.retryAfter / 60)} 分钟后再试。`,
      retryAfter: gate.retryAfter,
    }, { 'Retry-After': String(gate.retryAfter) });
  }

  const body = await readJsonBody(req);
  const userOk = safeEqual(String(body.username || '').trim(), cfg.username);
  const passOk = safeEqual(String(body.password || '').trim(), cfg.password);

  if (!(userOk && passOk)) {
    noteLoginFailure(req);
    // 失败时刻意放慢，拖慢暴力猜密码
    await new Promise(resolve => setTimeout(resolve, 800 + (gate.extraDelay || 0)));
    return sendJson(res, 401, { ok: false, error: 'invalid_credentials', message: '账号或密码不正确' });
  }

  clearLoginFailures(req);
  return sendJson(
    res,
    200,
    { ok: true, username: cfg.username },
    { 'Set-Cookie': sessionCookie(createSessionToken(cfg), req) },
  );
};
