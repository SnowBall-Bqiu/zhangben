import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_CHARACTERS, passwordByteLength, validateNewPassword } from '../src/utils/password.js';

const apiSource = await readFile(new URL('../src/api/index.js', import.meta.url), 'utf8');
const apiDataUrl = `data:text/javascript;base64,${Buffer.from(apiSource).toString('base64')}`;
let apiInstance = 0;

function response(status, data) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(data) };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Top-level node:test cases run serially, so each fetch stub belongs to one API
// instance. The unique module URL also isolates its session and CSRF caches.
async function createApi(t, handler) {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const api = await import(`${apiDataUrl}#security-test-${++apiInstance}`);
  let expired = 0;
  const unsubscribe = api.subscribeToSessionExpired(() => { expired++; });
  t.after(unsubscribe);
  return { api, calls, expired: () => expired };
}

test('password policy counts 15 Unicode code points and caps UTF-8 at 72 bytes', () => {
  assert.equal(MIN_PASSWORD_CHARACTERS, 15);
  assert.equal(MAX_PASSWORD_BYTES, 72);
  assert.equal(passwordByteLength('密'.repeat(24)), 72);
  assert.equal(passwordByteLength('😀'.repeat(18)), 72);

  for (const password of ['a'.repeat(15), 'a'.repeat(72), '密'.repeat(24), '😀'.repeat(15), '😀'.repeat(18)]) {
    assert.equal(validateNewPassword(password, 'old'), '');
  }
  for (const password of ['a'.repeat(14), '😀'.repeat(14)]) {
    assert.match(validateNewPassword(password, 'old'), /15/);
  }
  for (const password of ['a'.repeat(73), '密'.repeat(25), '😀'.repeat(19)]) {
    assert.match(validateNewPassword(password, 'old'), /72/);
  }
  for (const password of [' '.repeat(15), '\u00a0'.repeat(15)]) {
    assert.match(validateNewPassword(password, 'old'), /空白/);
  }
  assert.match(validateNewPassword('samePassword123', 'samePassword123'), /相同/);
});

test('an initial anonymous check and a wrong login do not signal session expiry', async t => {
  const h = await createApi(t, url => url.endsWith('/csrf')
    ? response(200, { csrfToken: 'anonymous' })
    : response(401, { message: 'unauthorized' }));

  await assert.rejects(h.api.fetchMe(), /unauthorized/);
  await assert.rejects(h.api.login('user', 'wrong'), /unauthorized/);

  assert.equal(h.expired(), 0);
  assert.equal(h.calls.length, 3, '401 handling must not cause recursive authentication requests');
});

test('concurrent authenticated 401 responses invalidate the session only once', async t => {
  const first = deferred();
  const second = deferred();
  const h = await createApi(t, url => {
    if (url.endsWith('/me')) return response(200, { user: { id: 1 } });
    if (url.endsWith('/summary')) return first.promise;
    if (url.endsWith('/trend')) return second.promise;
    throw new Error(`Unexpected request: ${url}`);
  });
  await h.api.fetchMe();

  const summary = assert.rejects(h.api.fetchDashboardSummary(), /expired/);
  const trend = assert.rejects(h.api.fetchDashboardTrend(), /会话已变更/);
  first.resolve(response(401, { message: 'expired' }));
  await summary;
  second.resolve(response(401, { message: 'expired' }));
  await trend;

  assert.equal(h.expired(), 1);
});

test('a late profile success cannot restore user state after session expiry', async t => {
  const profile = deferred();
  const profileStarted = deferred();
  const h = await createApi(t, url => {
    if (url.endsWith('/me')) return response(200, { user: { id: 1 } });
    if (url.endsWith('/csrf')) return response(200, { csrfToken: 'old' });
    if (url.endsWith('/profile')) { profileStarted.resolve(); return profile.promise; }
    if (url.endsWith('/summary')) return response(401, { message: 'expired' });
    throw new Error(`Unexpected request: ${url}`);
  });
  await h.api.fetchMe();

  let userRestored = false;
  const oldProfile = h.api.updateProfile({ nickname: 'old' }).then(() => { userRestored = true; });
  const rejected = assert.rejects(oldProfile, /会话已变更/);
  await profileStarted.promise;
  await assert.rejects(h.api.fetchDashboardSummary(), /expired/);
  profile.resolve(response(200, { user: { id: 1 }, csrfToken: 'stale' }));
  await rejected;

  assert.equal(userRestored, false);
  assert.equal(h.expired(), 1);
});

test('an old 401 cannot expire a new login or replace its CSRF token', async t => {
  const stale = deferred();
  const h = await createApi(t, url => {
    if (url.endsWith('/me')) return response(200, { user: { id: 1 } });
    if (url.endsWith('/csrf')) return response(200, { csrfToken: 'anonymous' });
    if (url.endsWith('/summary')) return stale.promise;
    if (url.endsWith('/login')) return response(200, { user: { id: 2 }, csrfToken: 'new-session' });
    if (url.endsWith('/logout') || url.endsWith('/transactions')) return response(200, {});
    throw new Error(`Unexpected request: ${url}`);
  });
  await h.api.fetchMe();

  const rejected = assert.rejects(h.api.fetchDashboardSummary(), /会话已变更/);
  await h.api.logout();
  await h.api.login('new-user', 'password');
  stale.resolve(response(401, { message: 'old session expired', csrfToken: 'stale' }));
  await rejected;
  await h.api.createTransaction({ name: 'new' });

  assert.equal(h.expired(), 0);
  assert.equal(h.calls.at(-1).options.headers['X-CSRF-Token'], 'new-session');
});

test('an old CSRF result cannot overwrite a new session or send an invalidated mutation', async t => {
  const oldCsrf = deferred();
  const oldCsrfStarted = deferred();
  const newCsrf = deferred();
  const newCsrfStarted = deferred();
  let csrfRequests = 0;
  const h = await createApi(t, url => {
    if (url.endsWith('/me')) return response(200, { user: { id: 1 } });
    if (url.endsWith('/csrf')) {
      if (++csrfRequests === 1) { oldCsrfStarted.resolve(); return oldCsrf.promise; }
      newCsrfStarted.resolve();
      return newCsrf.promise;
    }
    if (url.endsWith('/summary')) return response(401, { message: 'expired' });
    if (url.endsWith('/login')) return response(200, { user: { id: 2 }, csrfToken: 'new-session' });
    throw new Error(`Unexpected request: ${url}`);
  });
  await h.api.fetchMe();

  const rejected = assert.rejects(h.api.updateProfile({ nickname: 'old' }), /会话已变更/);
  await oldCsrfStarted.promise;
  await assert.rejects(h.api.fetchDashboardSummary(), /expired/);
  const login = h.api.login('new-user', 'password');
  await newCsrfStarted.promise;
  oldCsrf.resolve(response(200, { csrfToken: 'stale-token' }));
  await rejected;
  newCsrf.resolve(response(200, { csrfToken: 'fresh-token' }));
  await login;

  assert.equal(csrfRequests, 2);
  assert.equal(h.calls.find(call => call.url.endsWith('/login')).options.headers['X-CSRF-Token'], 'fresh-token');
  assert.equal(h.calls.some(call => call.url.endsWith('/profile')), false);
});

test('password rotation rejects old responses and preserves its replacement CSRF token', async t => {
  const stale = deferred();
  const h = await createApi(t, url => {
    if (url.endsWith('/me')) return response(200, { user: { id: 1 } });
    if (url.endsWith('/csrf')) return response(200, { csrfToken: 'old' });
    if (url.endsWith('/summary')) return stale.promise;
    if (url.endsWith('/change-password')) return response(200, { csrfToken: 'rotated' });
    if (url.endsWith('/transactions')) return response(200, {});
    throw new Error(`Unexpected request: ${url}`);
  });
  await h.api.fetchMe();

  const rejected = assert.rejects(h.api.fetchDashboardSummary(), /会话已变更/);
  await h.api.changePassword('old', 'newPasswordEnough');
  stale.resolve(response(200, { csrfToken: 'stale' }));
  await rejected;
  await h.api.createTransaction({ name: 'new' });

  assert.equal(h.calls.at(-1).options.headers['X-CSRF-Token'], 'rotated');
  assert.equal(h.expired(), 0);
});
