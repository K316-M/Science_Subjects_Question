const { sendJson, clearedSessionCookie, sameOrigin } = require('./_lib/devauth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });
  }
  if (!sameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: 'bad_origin' });
  }
  return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearedSessionCookie(req) });
};
