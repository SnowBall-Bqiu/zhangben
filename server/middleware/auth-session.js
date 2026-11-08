const { ensureCsrfToken } = require('./csrf');
const ABSOLUTE_SESSION_MS = 8 * 60 * 60 * 1000;
const IDLE_SESSION_MS = 30 * 60 * 1000;
const ACTIVITY_UPDATE_MS = 60 * 1000;

function rejectSession(req, res) {
  const respond = () => res.status(401).json({ error: true, message: '会话已失效，请重新登录' });
  if (!req.session) return respond();

  return req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: true, message: '会话注销失败，请重试' });
    }
    return respond();
  });
}

// Auth-only routes also need this check, even when first-login password changes are allowed.
function requireSession(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: true, message: '请先登录' });
  }

  const now = Date.now();
  const { authenticatedAt, lastActivityAt } = req.session;
  if (!Number.isSafeInteger(authenticatedAt) || !Number.isSafeInteger(lastActivityAt)
      || authenticatedAt < 0 || lastActivityAt < authenticatedAt
      || authenticatedAt > now || lastActivityAt > now
      || now - authenticatedAt >= ABSOLUTE_SESSION_MS
      || now - lastActivityAt >= IDLE_SESSION_MS) {
    return rejectSession(req, res);
  }

  const user = req.app.get('db').prepare(`
    SELECT id, username, nickname, password_hash, must_change_password, session_version, created_at
    FROM users WHERE id = ?
  `).get(req.session.userId);

  // Sessions created before the version migration must log in again.
  if (!user || !Number.isSafeInteger(req.session.sessionVersion)
      || req.session.sessionVersion !== user.session_version) {
    return rejectSession(req, res);
  }

  req.authUser = user;
  if (now - lastActivityAt >= ACTIVITY_UPDATE_MS) req.session.lastActivityAt = now;
  return next();
}

function regenerateAuthenticatedSession(req, user, callback) {
  req.session.regenerate(err => {
    if (err) return callback(err);

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.sessionVersion = user.session_version;
    req.session.authenticatedAt = Date.now();
    req.session.lastActivityAt = req.session.authenticatedAt;
    const csrfToken = ensureCsrfToken(req.session);
    // Report success only once the replacement session has been persisted.
    return req.session.save(saveErr => {
      if (saveErr) {
        // Do not let express-session retry and publish a failed replacement on res.end().
        return req.session.destroy(() => callback(saveErr));
      }
      return callback(null, csrfToken);
    });
  });
}

module.exports = { requireSession, rejectSession, regenerateAuthenticatedSession };
