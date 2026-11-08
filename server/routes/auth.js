const express = require('express');
const bcrypt = require('bcryptjs');
const { issueCsrfToken } = require('../middleware/csrf');
const { requireSession, rejectSession, regenerateAuthenticatedSession } = require('../middleware/auth-session');
const { validateOptionalText } = require('../utils/validation');
const { passwordInputError, newPasswordError } = require('../utils/password-policy');
const router = express.Router();

// 同时限制 IP 和用户名，避免轮换来源地址绕过登录尝试限制。
const attemptsByApp = new WeakMap();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;
const MAX_RATE_LIMIT_KEYS = 10000;

function rateLimits(req) {
  if (!attemptsByApp.has(req.app)) {
    attemptsByApp.set(req.app, { ips: new Map(), usernames: new Map(), passwordChanges: new Map() });
  }
  return attemptsByApp.get(req.app);
}

function checkRateLimit(records, key) {
  const now = Date.now();
  // Records retain insertion order because windows do not slide on subsequent attempts.
  for (const [oldKey, oldRecord] of records) {
    if (now - oldRecord.start < WINDOW_MS) break;
    records.delete(oldKey);
  }
  const record = records.get(key);
  if (!record) {
    // Never evict an active record: filling the map must not reset an existing limit.
    if (records.size >= MAX_RATE_LIMIT_KEYS) return false;
    records.set(key, { start: now, count: 1 });
    return true;
  }
  record.count = Math.min(record.count + 1, MAX_ATTEMPTS + 1);
  return record.count <= MAX_ATTEMPTS;
}

// GET /api/auth/csrf
router.get('/csrf', issueCsrfToken);

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const loginUsername = String(username || '').trim();
  if (!loginUsername || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: true, message: '请输入用户名和密码' });
  }

  if (loginUsername.length > 20 || /[\u0000-\u001F\u007F]/.test(loginUsername)) {
    return res.status(400).json({ error: true, message: '用户名格式不正确' });
  }

  const passwordError = passwordInputError(password);
  if (passwordError) {
    return res.status(400).json({ error: true, message: passwordError });
  }

  const limits = rateLimits(req);
  const ipAllowed = checkRateLimit(limits.ips, req.ip);
  const usernameAllowed = checkRateLimit(limits.usernames, loginUsername);
  if (!ipAllowed || !usernameAllowed) {
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

  // Let owners migrate older short passwords without allowing weak credentials into business routes.
  if (newPasswordError(password) && !user.must_change_password) {
    const result = db.prepare(`
      UPDATE users SET must_change_password = 1 WHERE id = ? AND password_hash = ?
    `).run(user.id, user.password_hash);
    if (result.changes !== 1) return rejectSession(req, res);
    user.must_change_password = 1;
  }

  regenerateAuthenticatedSession(req, user, (err, csrfToken) => {
    if (err) {
      return res.status(500).json({ error: true, message: '服务器内部错误' });
    }

    res.json({
      message: '登录成功',
      mustChangePassword: user.must_change_password === 1,
      csrfToken,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        mustChangePassword: user.must_change_password === 1
      }
    });
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  if (!req.session) {
    return res.json({ message: '已退出登录' });
  }

  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: true, message: '退出登录失败，请重试' });
    }
    res.json({ message: '已退出登录' });
  });
});

// POST /api/auth/change-password
router.post('/change-password', requireSession, (req, res) => {
  const currentPasswordText = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPasswordText = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  if (!currentPasswordText || !newPasswordText) {
    return res.status(400).json({ error: true, message: '请输入当前密码和新密码' });
  }

  const passwordError = passwordInputError(currentPasswordText) || newPasswordError(newPasswordText);
  if (passwordError) {
    return res.status(400).json({ error: true, message: passwordError });
  }

  const db = req.app.get('db');
  const user = req.authUser;
  if (!checkRateLimit(rateLimits(req).passwordChanges, user.id)) {
    return res.status(429).json({ error: true, message: '密码修改尝试过于频繁，请5分钟后再试' });
  }

  if (!bcrypt.compareSync(currentPasswordText, user.password_hash)) {
    return res.status(400).json({ error: true, message: '当前密码不正确' });
  }

  if (newPasswordText === currentPasswordText) {
    return res.status(400).json({ error: true, message: '新密码不能与当前密码相同' });
  }

  const hash = bcrypt.hashSync(newPasswordText, 10);
  const result = db.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = 0, session_version = session_version + 1
    WHERE id = ? AND session_version = ?
  `).run(hash, user.id, user.session_version);
  if (result.changes !== 1) return rejectSession(req, res);

  regenerateAuthenticatedSession(req, { ...user, session_version: user.session_version + 1 }, (err, csrfToken) => {
    if (err) {
      return res.status(500).json({ error: true, message: '密码已修改，请重新登录' });
    }
    return res.json({ message: '密码修改成功', csrfToken });
  });
});

// PUT /api/auth/profile - 修改用户名
router.put('/profile', requireSession, (req, res) => {
  const { username, nickname } = req.body;
  const db = req.app.get('db');
  const user = req.authUser;

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
    return rejectSession(req, res);
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
router.get('/me', requireSession, (req, res) => {
  const user = req.authUser;

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
