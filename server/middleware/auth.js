function authMiddleware(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: true, message: '请先登录' });
  }

  const db = req.app.get('db');
  const user = db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(req.session.userId);

  if (user && user.must_change_password && !req.path.includes('change-password') && req.path !== '/me') {
    return res.status(403).json({ error: true, message: '请先修改密码', mustChangePassword: true });
  }

  next();
}

module.exports = authMiddleware;
