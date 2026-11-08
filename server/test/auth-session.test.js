const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Duplex } = require('node:stream');
const express = require('express');
const session = require('express-session');
const signature = require('cookie-signature');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const authRoutes = require('../routes/auth');
const authMiddleware = require('../middleware/auth');
const { csrfMiddleware } = require('../middleware/csrf');
const { requireJsonBodyForApiWrites, jsonBodyParser } = require('../middleware/request-security');
const migration = require('../database/migrations/003_add_users_session_version');
const { MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES, passwordInputError, newPasswordError } = require('../utils/password-policy');

const SESSION_SECRET = 'auth-regression-memory-only-secret';
let fixtureCount = 0;

function fixture(t, { mustChangePassword = false, wireJson = false, password = 'old-password-123' } = {}) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, nickname TEXT,
      password_hash TEXT NOT NULL, must_change_password INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const number = ++fixtureCount;
  const username = `audit${number}`;
  db.prepare(`INSERT INTO users (id, username, nickname, password_hash, must_change_password)
    VALUES (1, ?, ?, ?, ?)`).run(username, username, bcrypt.hashSync(password, 4), Number(mustChangePassword));
  migration.up(db);
  const store = new session.MemoryStore();
  const app = express();
  app.set('db', db);
  if (wireJson) app.use('/api', requireJsonBodyForApiWrites, jsonBodyParser);
  app.use(session({
    name: 'test.sid', secret: SESSION_SECRET, store, resave: false, saveUninitialized: false,
    cookie: { maxAge: 604800000, httpOnly: true, sameSite: 'lax' }
  }));
  app.use('/api', csrfMiddleware);
  app.use('/api/auth', authRoutes);
  app.get('/api/protected', authMiddleware, (req, res) => res.json({ userId: req.session.userId }));

  // Real Express/express-session requests without sockets, listeners, or filesystem storage.
  async function request(path, { method = 'GET', cookie, csrfToken, body, ip = `203.0.113.${number}` } = {}) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const socket = new Duplex({
        read() {},
        write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); }
      });
      socket.remoteAddress = ip;
      const req = new http.IncomingMessage(socket);
      req.method = method;
      req.url = path;
      req.headers = { host: 'memory.test' };
      if (cookie) req.headers.cookie = cookie;
      if (csrfToken) req.headers['x-csrf-token'] = csrfToken;
      let payload;
      if (wireJson) {
        payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
        if (body !== undefined || !['GET', 'HEAD'].includes(method)) {
          req.headers['content-type'] = 'application/json';
          req.headers['content-length'] = String(payload.length);
        }
      } else {
        req.body = body || {};
      }
      const res = new http.ServerResponse(req);
      res.assignSocket(socket);
      res.on('error', reject);
      res.on('finish', () => {
        const wire = Buffer.concat(chunks).toString();
        const data = wire.slice(wire.indexOf('\r\n\r\n') + 4);
        const setCookie = res.getHeader('set-cookie');
        resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : {},
          cookie: setCookie ? setCookie[0].split(';')[0] : cookie,
          sid: req.sessionID
        });
        socket.destroy();
      });
      app.handle(req, res);
      if (wireJson) {
        req.complete = true;
        req.push(payload);
        req.push(null);
      }
    });
  }

  async function login(loginPassword = password, options = {}) {
    const anonymous = await request('/api/auth/csrf', options);
    return request('/api/auth/login', {
      ...options, method: 'POST', cookie: anonymous.cookie, csrfToken: anonymous.body.csrfToken,
      body: { username, password: loginPassword }
    });
  }

  function readSession(sid) {
    return new Promise((resolve, reject) => store.get(sid, (err, value) => err ? reject(err) : resolve(value)));
  }

  async function injectSession(sid, values) {
    await new Promise((resolve, reject) => store.set(sid, {
      cookie: { originalMaxAge: 604800000, expires: new Date(Date.now() + 604800000), httpOnly: true, path: '/' },
      authenticatedAt: Date.now(), lastActivityAt: Date.now(),
      ...values
    }, err => err ? reject(err) : resolve()));
    return 'test.sid=' + encodeURIComponent('s:' + signature.sign(sid, SESSION_SECRET));
  }

  return { db, store, username, request, login, readSession, injectSession };
}

test('migration is repeatable and versions existing users without trusting old sessions', async t => {
  const f = fixture(t);
  migration.up(f.db);
  assert.equal(f.db.prepare('SELECT session_version FROM users WHERE id = 1').get().session_version, 1);
  const cookie = await f.injectSession('legacy', { userId: 1, csrfToken: 'old-csrf' });
  const response = await f.request('/api/auth/me', { cookie });
  assert.equal(response.status, 401);
  assert.equal(await f.readSession('legacy'), undefined);
});

test('login persists the current user session version and rotates the anonymous session', async t => {
  const f = fixture(t);
  const anonymous = await f.request('/api/auth/csrf');
  const loggedIn = await f.request('/api/auth/login', {
    method: 'POST', cookie: anonymous.cookie, csrfToken: anonymous.body.csrfToken,
    body: { username: f.username, password: 'old-password-123' }
  });
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.body.user.mustChangePassword, false);
  assert.notEqual(loggedIn.sid, anonymous.sid);
  assert.notEqual(loggedIn.body.csrfToken, anonymous.body.csrfToken);
  assert.equal((await f.readSession(loggedIn.sid)).sessionVersion, 1);
  assert.equal(await f.readSession(anonymous.sid), undefined);
});

test('password changes revoke every old session across business and auth routes', async t => {
  const f = fixture(t);
  const victim = await f.login();
  const attacker = await f.login();
  const changed = await f.request('/api/auth/change-password', {
    method: 'POST', cookie: victim.cookie, csrfToken: victim.body.csrfToken,
    body: { currentPassword: 'old-password-123', newPassword: 'new-password-456' }
  });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.sid, victim.sid);
  assert.notEqual(changed.body.csrfToken, victim.body.csrfToken);
  assert.equal(await f.readSession(victim.sid), undefined);
  assert.equal((await f.readSession(changed.sid)).sessionVersion, 2);
  const user = f.db.prepare('SELECT * FROM users WHERE id = 1').get();
  assert.equal(user.session_version, 2);
  assert.equal(bcrypt.compareSync('old-password-123', user.password_hash), false);
  assert.equal(bcrypt.compareSync('new-password-456', user.password_hash), true);
  assert.equal((await f.request('/api/auth/me', { cookie: changed.cookie })).status, 200);
  assert.equal((await f.request('/api/protected', { cookie: changed.cookie })).status, 200);

  for (const [index, path, method, body] of [
    [0, '/api/protected', 'GET', {}],
    [1, '/api/auth/me', 'GET', {}],
    [2, '/api/auth/profile', 'PUT', { username: 'hijacked' }],
    [3, '/api/auth/change-password', 'POST', { currentPassword: 'new-password-456', newPassword: 'attacker-password-123' }]
  ]) {
    // Preserve an independently stored copy so each guard is exercised, rather than only missing-session checks.
    const staleCookie = await f.injectSession(`stale-${index}`, {
      userId: 1, sessionVersion: 1, csrfToken: attacker.body.csrfToken
    });
    const rejected = await f.request(path, { method, cookie: staleCookie, csrfToken: attacker.body.csrfToken, body });
    assert.equal(rejected.status, 401, path);
    assert.equal(await f.readSession(`stale-${index}`), undefined);
  }

  assert.equal((await f.request('/api/auth/me', { cookie: attacker.cookie })).status, 401);
  const oldToken = await f.request('/api/auth/profile', {
    method: 'PUT', cookie: changed.cookie, csrfToken: victim.body.csrfToken, body: { username: 'changeduser' }
  });
  assert.equal(oldToken.status, 403);
  assert.equal(oldToken.body.code, 'CSRF_INVALID');
  assert.equal((await f.request('/api/auth/profile', {
    method: 'PUT', cookie: changed.cookie, csrfToken: changed.body.csrfToken,
    body: { username: 'changeduser', nickname: 'Changed' }
  })).status, 200);
});

test('first-login sessions can inspect identity and change password but cannot use business/profile routes', async t => {
  const f = fixture(t, { mustChangePassword: true });
  const loggedIn = await f.login();
  assert.equal(loggedIn.body.mustChangePassword, true);
  assert.equal(loggedIn.body.user.mustChangePassword, true);
  assert.equal((await f.request('/api/auth/me', { cookie: loggedIn.cookie })).status, 200);
  assert.equal((await f.request('/api/protected', { cookie: loggedIn.cookie })).status, 403);
  assert.equal((await f.request('/api/auth/profile', {
    method: 'PUT', cookie: loggedIn.cookie, csrfToken: loggedIn.body.csrfToken, body: { username: 'newname' }
  })).status, 403);
  const changed = await f.request('/api/auth/change-password', {
    method: 'POST', cookie: loggedIn.cookie, csrfToken: loggedIn.body.csrfToken,
    body: { currentPassword: 'old-password-123', newPassword: 'first-password-123' }
  });
  assert.equal(changed.status, 200);
  const me = await f.request('/api/auth/me', { cookie: changed.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.mustChangePassword, false);
  assert.equal((await f.request('/api/protected', { cookie: changed.cookie })).status, 200);
});

test('JSON parsing, session, CSRF and auth compose through login, first password change and continued use', async t => {
  const f = fixture(t, { mustChangePassword: true, wireJson: true });
  const anonymous = await f.request('/API/auth/csrf');
  assert.equal(anonymous.status, 200);
  const loggedIn = await f.request('/Api/auth/login', {
    method: 'POST', cookie: anonymous.cookie, csrfToken: anonymous.body.csrfToken,
    body: { username: f.username, password: 'old-password-123' }
  });
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.body.mustChangePassword, true);
  assert.equal(loggedIn.body.user.mustChangePassword, true);
  assert.equal((await f.request('/api/protected', { cookie: loggedIn.cookie })).status, 403);
  const changed = await f.request('/aPi/auth/change-password', {
    method: 'POST', cookie: loggedIn.cookie, csrfToken: loggedIn.body.csrfToken,
    body: { currentPassword: 'old-password-123', newPassword: 'wire-password-456' }
  });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.sid, loggedIn.sid);
  assert.notEqual(changed.body.csrfToken, loggedIn.body.csrfToken);
  const me = await f.request('/API/auth/me', { cookie: changed.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.mustChangePassword, false);
  const profile = await f.request('/API/auth/profile', {
    method: 'PUT', cookie: changed.cookie, csrfToken: changed.body.csrfToken,
    body: { username: 'wire_changed_owner', nickname: 'Updated over JSON' }
  });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.user.username, 'wire_changed_owner');
  assert.equal(profile.body.user.nickname, 'Updated over JSON');
  assert.equal((await f.request('/api/protected', { cookie: changed.cookie })).status, 200);
  assert.equal((await f.readSession(changed.sid)).sessionVersion, 2);
});

test('password mismatch leaves the existing session/version usable', async t => {
  const f = fixture(t);
  const loggedIn = await f.login();
  const failed = await f.request('/api/auth/change-password', {
    method: 'POST', cookie: loggedIn.cookie, csrfToken: loggedIn.body.csrfToken,
    body: { currentPassword: 'wrongpass', newPassword: 'new-password-456' }
  });
  assert.equal(failed.status, 400);
  assert.equal(f.db.prepare('SELECT session_version FROM users WHERE id = 1').get().session_version, 1);
  assert.equal((await f.request('/api/protected', { cookie: loggedIn.cookie })).status, 200);
});

test('failed session deletion never reports a successful logout', async t => {
  const f = fixture(t);
  const loggedIn = await f.login();
  const destroy = f.store.destroy;
  f.store.destroy = (sid, callback) => callback(new Error('simulated store failure'));
  t.after(() => { f.store.destroy = destroy; });
  const response = await f.request('/api/auth/logout', {
    method: 'POST', cookie: loggedIn.cookie, csrfToken: loggedIn.body.csrfToken
  });
  assert.equal(response.status, 500);
  assert.equal(response.body.error, true);
  assert.ok(await f.readSession(loggedIn.sid));
});

test('password change revokes old access even if regenerating the current session fails', async t => {
  const f = fixture(t);
  const loggedIn = await f.login();
  const destroy = f.store.destroy;
  f.store.destroy = (sid, callback) => callback(new Error('simulated regeneration failure'));
  const response = await f.request('/api/auth/change-password', {
    method: 'POST', cookie: loggedIn.cookie, csrfToken: loggedIn.body.csrfToken,
    body: { currentPassword: 'old-password-123', newPassword: 'new-password-456' }
  });
  f.store.destroy = destroy;
  assert.equal(response.status, 500);
  assert.equal(f.db.prepare('SELECT session_version FROM users WHERE id = 1').get().session_version, 2);
  assert.equal((await f.request('/api/protected', { cookie: loggedIn.cookie })).status, 401);
});

test('password change reports session-save failures and leaves preexisting sessions revoked', async t => {
  const f = fixture(t);
  const loggedIn = await f.login();
  const attacker = await f.login();
  const set = f.store.set;
  f.store.set = (sid, value, callback) => callback(new Error('simulated session-save failure'));
  const response = await f.request('/api/auth/change-password', {
    method: 'POST', cookie: loggedIn.cookie, csrfToken: loggedIn.body.csrfToken,
    body: { currentPassword: 'old-password-123', newPassword: 'new-password-456' }
  });
  f.store.set = set;
  assert.equal(response.status, 500);
  assert.equal(await f.readSession(response.sid), undefined);
  assert.equal((await f.request('/api/protected', { cookie: attacker.cookie })).status, 401);
});

test('username throttling remains effective when the source address changes', async t => {
  const f = fixture(t);
  for (let index = 0; index < 5; index++) {
    assert.equal((await f.login('wrongpass', { ip: `198.51.100.${index + 1}` })).status, 401);
  }
  assert.equal((await f.login('old-password-123', { ip: '198.51.100.99' })).status, 429);
});

test('IP throttling still applies across different usernames', async t => {
  const f = fixture(t);
  const anonymous = await f.request('/api/auth/csrf');
  for (let index = 0; index < 6; index++) {
    const response = await f.request('/api/auth/login', {
      method: 'POST', cookie: anonymous.cookie, csrfToken: anonymous.body.csrfToken,
      body: { username: `missing${index}`, password: 'wrongpass' }
    });
    assert.equal(response.status, index < 5 ? 401 : 429);
  }
});

test('password policy counts Unicode characters and enforces the bcrypt UTF-8 byte boundary', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 15);
  assert.equal(MAX_PASSWORD_BYTES, 72);
  for (const value of [undefined, null, 123, '', ' '.repeat(15), '\t\n']) {
    assert.ok(passwordInputError(value));
  }
  assert.equal(passwordInputError('legacy123'), null);
  assert.ok(newPasswordError('a'.repeat(14)));
  assert.equal(newPasswordError('a'.repeat(15)), null);
  assert.ok(newPasswordError('😀'.repeat(14)));
  assert.equal(newPasswordError('😀'.repeat(15)), null);
  assert.equal(newPasswordError('密'.repeat(24)), null);
  assert.ok(newPasswordError('密'.repeat(25)));
  assert.equal(newPasswordError('a'.repeat(72)), null);
  assert.ok(passwordInputError('a'.repeat(73)));
});

test('legacy short passwords can log in only to migrate, and a strong change unlocks business routes', async t => {
  const f = fixture(t, { password: 'legacy123' });
  const loggedIn = await f.login();
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.body.mustChangePassword, true);
  assert.equal(loggedIn.body.user.mustChangePassword, true);
  assert.equal(f.db.prepare('SELECT must_change_password FROM users WHERE id = 1').get().must_change_password, 1);
  assert.equal((await f.request('/api/protected', { cookie: loggedIn.cookie })).status, 403);
  assert.equal((await f.request('/api/auth/me', { cookie: loggedIn.cookie })).body.user.mustChangePassword, true);
  const changed = await f.request('/api/auth/change-password', {
    method: 'POST', cookie: loggedIn.cookie, csrfToken: loggedIn.body.csrfToken,
    body: { currentPassword: 'legacy123', newPassword: 'upgraded-password-456' }
  });
  assert.equal(changed.status, 200);
  assert.equal((await f.request('/api/protected', { cookie: changed.cookie })).status, 200);
  assert.equal((await f.login('upgraded-password-456')).body.mustChangePassword, false);
});

test('login rejects overlong or blank passwords before bcrypt can truncate them', async t => {
  const f = fixture(t, { password: 'a'.repeat(72) });
  for (const password of ['a'.repeat(73), '密'.repeat(25), ' '.repeat(15)]) {
    assert.equal((await f.login(password)).status, 400);
  }
  assert.equal((await f.login('a'.repeat(72))).status, 200);
});

test('password changes reject weak, overlong, blank or unchanged values without modifying credentials', async t => {
  const f = fixture(t);
  const loggedIn = await f.login();
  const before = f.db.prepare('SELECT password_hash, session_version FROM users WHERE id = 1').get();
  for (const newPassword of ['a'.repeat(14), ' '.repeat(15), 'a'.repeat(73), '密'.repeat(25), '😀'.repeat(14), 'old-password-123']) {
    const response = await f.request('/api/auth/change-password', {
      method: 'POST', cookie: loggedIn.cookie, csrfToken: loggedIn.body.csrfToken,
      body: { currentPassword: 'old-password-123', newPassword }
    });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(f.db.prepare('SELECT password_hash, session_version FROM users WHERE id = 1').get(), before);
  const changed = await f.request('/api/auth/change-password', {
    method: 'POST', cookie: loggedIn.cookie, csrfToken: loggedIn.body.csrfToken,
    body: { currentPassword: 'old-password-123', newPassword: '密'.repeat(24) }
  });
  assert.equal(changed.status, 200);
  assert.equal(bcrypt.compareSync('密'.repeat(24), f.db.prepare('SELECT password_hash FROM users WHERE id = 1').get().password_hash), true);
});

test('current-password guessing is limited per user across sessions and source addresses, then recovers', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t);
  const clients = [await f.login(), await f.login()];
  for (let index = 0; index < 5; index++) {
    const client = clients[index % clients.length];
    const response = await f.request('/api/auth/change-password', {
      method: 'POST', cookie: client.cookie, csrfToken: client.body.csrfToken, ip: `198.51.100.${index + 1}`,
      body: { currentPassword: `wrongpass${index}`, newPassword: 'replacement-password-456' }
    });
    assert.equal(response.status, 400);
  }
  const options = {
    method: 'POST', cookie: clients[0].cookie, csrfToken: clients[0].body.csrfToken,
    body: { currentPassword: 'old-password-123', newPassword: 'replacement-password-456' }
  };
  assert.equal((await f.request('/api/auth/change-password', options)).status, 429);
  now += 5 * 60 * 1000;
  assert.equal((await f.request('/api/auth/change-password', options)).status, 200);
});

test('login rate-limit tables stay bounded without evicting active limits and expire at the window boundary', t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const app = express();
  let lookups = 0;
  app.set('db', { prepare() { return { get() { lookups++; return undefined; } }; } });
  const loginHandler = authRoutes.stack.find(layer => layer.route && layer.route.path === '/login').route.stack[0].handle;
  function attempt(ip, username) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
    loginHandler({ app, ip, body: { username, password: 'wrong-password-123' } }, response);
    return response.statusCode;
  }
  for (let index = 0; index < 5; index++) assert.equal(attempt('victim-source', 'victim'), 401);
  assert.equal(attempt('victim-source', 'victim'), 429);
  for (let index = 0; index < 9999; index++) {
    assert.equal(attempt(`source-${index}`, `capacity-${index}`), 401);
  }
  const lookupsBeforeOverflow = lookups;
  for (let index = 0; index < 20; index++) assert.equal(attempt(`overflow-${index}`, `overflow-${index}`), 429);
  assert.equal(lookups, lookupsBeforeOverflow);
  assert.equal(attempt('victim-source', 'victim'), 429);
  now += 5 * 60 * 1000;
  assert.equal(attempt('victim-source', 'victim'), 401);
});

test('session timestamps must exist, be ordered safe integers and never point into the future', async t => {
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t);
  const invalidTimes = [
    { authenticatedAt: undefined }, { lastActivityAt: undefined },
    { authenticatedAt: String(now) }, { lastActivityAt: null },
    { authenticatedAt: -1 }, { authenticatedAt: now + 1 },
    { lastActivityAt: now + 1 }, { authenticatedAt: now, lastActivityAt: now - 1 }
  ];
  for (const [index, times] of invalidTimes.entries()) {
    const cookie = await f.injectSession(`invalid-time-${index}`, { userId: 1, sessionVersion: 1, ...times });
    assert.equal((await f.request('/api/auth/me', { cookie })).status, 401);
    assert.equal(await f.readSession(`invalid-time-${index}`), undefined);
  }
});

test('idle expiry occurs at thirty minutes even within the absolute session lifetime', async t => {
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t);
  const cookie = await f.injectSession('idle-expired', {
    userId: 1, sessionVersion: 1, authenticatedAt: now - 60 * 60 * 1000,
    lastActivityAt: now - 30 * 60 * 1000
  });
  assert.equal((await f.request('/api/protected', { cookie })).status, 401);
  assert.equal(await f.readSession('idle-expired'), undefined);
});

test('successful activity updates are throttled and cannot extend the absolute eight-hour deadline', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t);
  const authenticatedAt = now - 8 * 60 * 60 * 1000 + 2 * 60 * 1000;
  const cookie = await f.injectSession('active-near-deadline', {
    userId: 1, sessionVersion: 1, authenticatedAt, lastActivityAt: now - 60 * 1000
  });
  assert.equal((await f.request('/api/protected', { cookie })).status, 200);
  assert.equal((await f.readSession('active-near-deadline')).lastActivityAt, now);
  assert.equal((await f.readSession('active-near-deadline')).authenticatedAt, authenticatedAt);
  now += 30 * 1000;
  assert.equal((await f.request('/api/auth/me', { cookie })).status, 200);
  assert.equal((await f.readSession('active-near-deadline')).lastActivityAt, now - 30 * 1000);
  now += 90 * 1000;
  assert.equal((await f.request('/api/protected', { cookie })).status, 401);
  assert.equal(await f.readSession('active-near-deadline'), undefined);
});
