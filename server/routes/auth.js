const express = require('express');
const bcrypt = require('bcryptjs');
const { ensureCsrfToken, issueCsrfToken } = require('../middleware/csrf');
const { validateOptionalText } = require('../utils/validation');
const router = express.Router();

// 简单的内存限流：每个IP 5分钟内最多5次登录尝试
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now - record.start > WINDOW_MS) {
    loginAttempts.set(ip, { start: now, count: 1 });
    return true;
  }
  record.count++;
  return record.count <= MAX_ATTEMPTS;
}

function destroySession(req, res, statusCode, message) {
  if (!req.session) {
    return res.status(statusCode).json({ error: true, message });
  }

  req.session.destroy(() => {
    res.status(statusCode).json({ error: true, message });
  });
}

// GET /api/auth/csrf
router.get('/csrf', issueCsrfToken);

// 定期清理过期记录
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts) {
    if (now - record.start > WINDOW_MS) loginAttempts.delete(ip);
  }
}, WINDOW_MS);

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const loginUsername = String(username || '').trim();
  if (!loginUsername || !password) {
    return res.status(400).json({ error: true, message: '请输入用户名和密码' });
  }

  if (loginUsername.length > 20 || /[\u0000-\u001F\u007F]/.test(loginUsername)) {
    return res.status(400).json({ error: true, message: '用户名格式不正确' });
  }

  if (!checkRateLimit(req.ip)) {
    return res.status(429).json({ error: true, message: '登录尝试过于频繁，请5分钟后再试' });
  }

  const db = req.app.get('db');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(loginUsername);
  if (!user) {
    return res.status(401).json({ error: true, message: '用户名或密码错误' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: true, message: '用户名或密码错误' });
  }

  req.session.regenerate(err => {
    if (err) {
      return res.status(500).json({ error: true, message: '服务器内部错误' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    const csrfToken = ensureCsrfToken(req.session);

    res.json({
      message: '登录成功',
      mustChangePassword: user.must_change_password === 1,
      csrfToken,
      user: { id: user.id, username: user.username, nickname: user.nickname }
    });
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  if (!req.session) {
    return res.json({ message: '已退出登录' });
  }

  req.session.destroy(() => {
    res.json({ message: '已退出登录' });
  });
});

// POST /api/auth/change-password
router.post('/change-password', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: true, message: '请先登录' });
  }

  const currentPasswordText = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPasswordText = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  if (!currentPasswordText || !newPasswordText) {
    return res.status(400).json({ error: true, message: '请输入当前密码和新密码' });
  }

  if (newPasswordText.length < 6) {
    return res.status(400).json({ error: true, message: '密码长度不能少于6位' });
  }

  const db = req.app.get('db');
  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    return destroySession(req, res, 401, '会话已失效，请重新登录');
  }

  if (!bcrypt.compareSync(currentPasswordText, user.password_hash)) {
    return res.status(400).json({ error: true, message: '当前密码不正确' });
  }

  const hash = bcrypt.hashSync(newPasswordText, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, req.session.userId);

  res.json({ message: '密码修改成功' });
});

// PUT /api/auth/profile - 修改用户名
router.put('/profile', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: true, message: '请先登录' });
  }

  const { username, nickname } = req.body;
  const db = req.app.get('db');
  const user = db.prepare('SELECT id, must_change_password FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    return destroySession(req, res, 401, '会话已失效，请重新登录');
  }

  if (user.must_change_password) {
    return res.status(403).json({ error: true, message: '请先修改密码', mustChangePassword: true });
  }

  const normalizedUsername = String(username || '').trim();
  const normalizedNickname = validateOptionalText(nickname, '昵称', 20);

  if (!normalizedUsername || normalizedUsername.length < 2) {
    return res.status(400).json({ error: true, message: '用户名至少2个字符' });
  }

  if (normalizedUsername.length > 20) {
    return res.status(400).json({ error: true, message: '用户名长度不能超过20个字符' });
  }

  if (/[\u0000-\u001F\u007F]/.test(normalizedUsername)) {
    return res.status(400).json({ error: true, message: '用户名不能包含控制字符' });
  }

  // 检查用户名是否已被占用
  const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(normalizedUsername, req.session.userId);
  if (existing) {
    return res.status(400).json({ error: true, message: '该用户名已被占用' });
  }

  db.prepare('UPDATE users SET username = ?, nickname = ? WHERE id = ?').run(normalizedUsername, normalizedNickname || normalizedUsername, req.session.userId);

  const updatedUser = db.prepare('SELECT id, username, nickname, must_change_password, created_at FROM users WHERE id = ?').get(req.session.userId);
  if (!updatedUser) {
    return destroySession(req, res, 401, '会话已失效，请重新登录');
  }

  res.json({
    message: '用户信息修改成功',
    user: {
      id: updatedUser.id,
      username: updatedUser.username,
      nickname: updatedUser.nickname,
      mustChangePassword: updatedUser.must_change_password === 1,
      createdAt: updatedUser.created_at
    }
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: true, message: '请先登录' });
  }

  const db = req.app.get('db');
  const user = db.prepare('SELECT id, username, nickname, must_change_password, created_at FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    return destroySession(req, res, 401, '会话已失效，请重新登录');
  }

  res.json({
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      mustChangePassword: user.must_change_password === 1,
      createdAt: user.created_at
    }
  });
});

module.exports = router;
