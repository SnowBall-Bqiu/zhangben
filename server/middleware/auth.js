const { requireSession } = require('./auth-session');

function authMiddleware(req, res, next) {
  return requireSession(req, res, () => {
    if (req.authUser.must_change_password) {
      return res.status(403).json({ error: true, message: '请先修改密码', mustChangePassword: true });
    }

    return next();
  });
}

module.exports = authMiddleware;
