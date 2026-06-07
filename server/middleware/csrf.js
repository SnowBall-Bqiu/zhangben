const crypto = require('crypto');

function ensureCsrfToken(session) {
  if (!session.csrfToken) {
    session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return session.csrfToken;
}

function shouldValidateCsrf(req) {
  const path = req.originalUrl.split('?')[0];
  if (!path.startsWith('/api/')) return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  if (path === '/api/auth/csrf') return false;
  return true;
}

function csrfMiddleware(req, res, next) {
  if (!shouldValidateCsrf(req)) {
    return next();
  }

  if (!req.session) {
    return res.status(403).json({ error: true, code: 'CSRF_INVALID', message: 'CSRF 令牌无效' });
  }

  const expected = req.session.csrfToken;
  const provided = req.get('X-CSRF-Token');

  if (!expected || !provided || provided !== expected) {
    return res.status(403).json({ error: true, code: 'CSRF_INVALID', message: 'CSRF 令牌无效' });
  }

  return next();
}

function issueCsrfToken(req, res) {
  if (!req.session) {
    return res.status(500).json({ error: true, message: '服务器内部错误' });
  }

  const csrfToken = ensureCsrfToken(req.session);
  return res.json({ message: 'CSRF 令牌获取成功', csrfToken });
}

module.exports = {
  ensureCsrfToken,
  csrfMiddleware,
  issueCsrfToken,
};
