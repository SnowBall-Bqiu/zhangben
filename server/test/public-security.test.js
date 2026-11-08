const test = require('node:test');
const assert = require('node:assert/strict');
const { readSecurityConfig } = require('../utils/security-config');
const { enforcePublicAccess, apiNoStore } = require('../middleware/request-security');
const { createApiRateLimit } = require('../middleware/api-rate-limit');
const securityHeaders = require('../middleware/security-headers');
const Store = require('../middleware/session-store');

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production', SESSION_SECRET: 'test-only-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    TRUSTED_PROXIES: '127.0.0.1', PUBLIC_ORIGIN: 'https://ledger.example.com', ...overrides,
  };
}

function invoke(middleware, { headers = {}, method = 'GET', secure = true, ip = '192.0.2.1' } = {}) {
  const result = { next: false, status: 200, headers: {} };
  const req = { method, secure, ip, get: name => headers[name.toLowerCase()] };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
    set(name, value) { result.headers[name.toLowerCase()] = value; return this; },
    setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
  };
  middleware(req, res, () => { result.next = true; });
  return result;
}

test('production requires explicit safe deployment settings and defaults to Secure cookies', () => {
  const config = readSecurityConfig(productionEnv());
  assert.equal(config.secureCookie, true);
  assert.equal(config.publicOrigin, 'https://ledger.example.com');
  for (const overrides of [
    { SESSION_SECRET: '' }, { SESSION_SECRET: 'short-secret' },
    { SESSION_SECRET: 'a'.repeat(64) }, { SESSION_SECRET: 'change-this-session-secret-example-12345' },
    { SESSION_COOKIE_SECURE: 'false' }, { SESSION_COOKIE_SECURE: 'typo' },
    { TRUSTED_PROXIES: '' }, { TRUSTED_PROXIES: 'true' }, { TRUSTED_PROXIES: '1' },
    { TRUSTED_PROXIES: ',' }, { TRUSTED_PROXIES: ' , ' }, { TRUSTED_PROXIES: 'not-an-ip' },
    { TRUSTED_PROXIES: '0.0.0.0/0' }, { TRUSTED_PROXIES: '::/0' },
    { TRUSTED_PROXIES: '0.0.0.0/00' }, { TRUSTED_PROXIES: '0:0:0:0:0:0:0:0/0' },
    { PUBLIC_ORIGIN: '' }, { PUBLIC_ORIGIN: 'http://ledger.example.com' },
    { PUBLIC_ORIGIN: 'https://ledger.example.com/path' },
    { PUBLIC_ORIGIN: 'https://user:pass@ledger.example.com' },
    { PUBLIC_ORIGIN: 'https://ledger.example.com/?unexpected=1' },
  ]) assert.throws(() => readSecurityConfig(productionEnv(overrides)));
  assert.throws(() => readSecurityConfig({ NODE_ENV: 'staging' }));
  assert.throws(() => readSecurityConfig({ NODE_ENV: 'prodution' }));
});

test('local development can use loopback HTTP without production credentials', () => {
  const config = readSecurityConfig({ NODE_ENV: 'development' });
  assert.equal(config.isProduction, false);
  assert.equal(config.secureCookie, false);
  assert.equal(invoke(enforcePublicAccess(config), { secure: false }).next, true);
});

test('production rejects incorrect hosts, plain HTTP and cross-origin writes', () => {
  const guard = enforcePublicAccess(readSecurityConfig(productionEnv()));
  const headers = { host: 'ledger.example.com' };
  assert.equal(invoke(guard, { headers }).next, true);
  assert.equal(invoke(guard, { headers: { host: 'attacker.example' } }).status, 421);
  assert.equal(invoke(guard, { headers, secure: false }).status, 426);
  assert.equal(invoke(guard, { method: 'POST', headers: { ...headers, origin: 'https://attacker.example' } }).status, 403);
  assert.equal(invoke(guard, { method: 'POST', headers: { ...headers, origin: 'null' } }).status, 403);
  assert.equal(invoke(guard, { method: 'POST', headers: { ...headers, 'sec-fetch-site': 'cross-site' } }).status, 403);
  assert.equal(invoke(guard, { method: 'POST', headers: { ...headers, origin: 'https://ledger.example.com' } }).next, true);
  // Non-browser clients still need the normal session and CSRF checks downstream.
  assert.equal(invoke(guard, { method: 'POST', headers }).next, true);
});

test('API responses forbid caching and HSTS is emitted only on a verified secure connection', () => {
  assert.equal(invoke(apiNoStore).headers['cache-control'], 'no-store');
  assert.equal(invoke(securityHeaders).headers['strict-transport-security'], 'max-age=31536000');
  assert.equal(invoke(securityHeaders, { secure: false }).headers['strict-transport-security'], undefined);
});

test('API throttling limits an IP, bounds tracking state and recovers after the window', () => {
  let time = 10000;
  const limiter = createApiRateLimit({ maxRequests: 2, maxEntries: 2, windowMs: 1000, now: () => time });
  assert.equal(invoke(limiter).next, true);
  assert.equal(invoke(limiter).next, true);
  const blocked = invoke(limiter);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['retry-after'], '1');
  assert.equal(invoke(limiter, { ip: '192.0.2.2' }).next, true);
  assert.equal(invoke(limiter, { ip: '192.0.2.3' }).status, 429);
  assert.equal(invoke(limiter).status, 429); // Filling state never resets the first IP's quota.
  time += 1000;
  assert.equal(invoke(limiter, { ip: '192.0.2.3' }).next, true);
  assert.equal(invoke(limiter).next, true);
});

function setSession(store, id, session) {
  return new Promise((resolve, reject) => store.set(id, session, err => err ? reject(err) : resolve()));
}

test('anonymous sessions expire quickly and full storage preserves existing sessions', async t => {
  const store = new Store({ dbPath: ':memory:', maxSessions: 2 });
  t.after(() => store.close());
  const before = Date.now();
  await setSession(store, 'anonymous', { cookie: { maxAge: 8 * 3600000 }, csrfToken: 'a' });
  await setSession(store, 'authenticated', { cookie: { maxAge: 8 * 3600000 }, userId: 1 });
  const anonymous = store.db.prepare('SELECT expired FROM sessions WHERE sid = ?').get('anonymous');
  assert.ok(anonymous.expired >= before);
  assert.ok(anonymous.expired <= Date.now() + 10 * 60000);
  const authenticated = store.db.prepare('SELECT expired FROM sessions WHERE sid = ?').get('authenticated');
  assert.ok(authenticated.expired >= before + 7 * 3600000);
  await assert.rejects(setSession(store, 'overflow', { cookie: {}, csrfToken: 'b' }), /capacity/);
  await setSession(store, 'authenticated', { cookie: { maxAge: 8 * 3600000 }, userId: 1, sessionVersion: 2 });
  assert.equal(JSON.parse(store.db.prepare('SELECT sess FROM sessions WHERE sid = ?').get('authenticated').sess).sessionVersion, 2);
  store.db.prepare('UPDATE sessions SET expired = ? WHERE sid = ?').run(Date.now() - 1000, 'anonymous');
  await setSession(store, 'new-anonymous', { cookie: {}, csrfToken: 'c' });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 2);
  assert.equal(store.db.prepare('SELECT sid FROM sessions WHERE sid = ?').get('anonymous'), undefined);
});
