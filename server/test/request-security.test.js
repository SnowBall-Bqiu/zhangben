const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Duplex } = require('node:stream');
const { gzipSync, deflateSync } = require('node:zlib');
const express = require('express');
const { csrfMiddleware } = require('../middleware/csrf');
const { requireJsonBodyForApiWrites, jsonBodyParser, configureProxyTrust } = require('../middleware/request-security');

function request(app, path, { method = 'GET', headers = {}, body, ip = '203.0.113.10' } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = new Duplex({
      read() {},
      write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
    });
    socket.remoteAddress = ip;
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = path;
    const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(body);
    req.headers = { host: 'memory.test', ...headers };
    if (body !== undefined) req.headers['content-length'] = String(payload.length);
    const res = new http.ServerResponse(req);
    res.assignSocket(socket);
    res.on('error', reject);
    res.on('finish', () => {
      const wire = Buffer.concat(chunks).toString();
      const data = wire.slice(wire.indexOf('\r\n\r\n') + 4);
      resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
      socket.destroy();
    });
    app.handle(req, res);
    req.push(payload);
    req.push(null);
  });
}

function apiFixture() {
  const app = express();
  let mutations = 0;
  app.use('/api', requireJsonBodyForApiWrites, jsonBodyParser);
  app.use((req, res, next) => { req.session = { csrfToken: 'valid-token' }; next(); });
  app.use('/api', csrfMiddleware);
  app.get('/api/accounts', (req, res) => res.json({ ok: true }));
  for (const method of ['post', 'put', 'patch', 'delete']) {
    app[method]('/api/accounts', (req, res) => {
      mutations++;
      res.json({ received: req.body });
    });
  }
  app.post('/api', (req, res) => { mutations++; res.json({ ok: true }); });
  app.use((err, req, res, next) => res.status(err.status || 500).json({ type: err.type }));
  return { app, mutations: () => mutations };
}

test('all API path casing rejects forms and tokenless writes before a mutation', async () => {
  const f = apiFixture();
  for (const path of ['/api/accounts', '/API/accounts', '/Api/accounts', '/aPi/accounts', '/API']) {
    const form = await request(f.app, path, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=csrf-proof&type=cash',
    });
    assert.equal(form.status, 415, path);
    const json = await request(f.app, path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"csrf-proof"}',
    });
    assert.equal(json.status, 403, path);
    assert.equal(json.body.code, 'CSRF_INVALID');
  }
  assert.equal(f.mutations(), 0);
});

test('valid token and JSON still work for mixed-case routes and JSON media subtypes', async () => {
  const f = apiFixture();
  for (const path of ['/api/accounts', '/API/accounts']) {
    for (const contentType of ['application/json', 'application/problem+json']) {
      const response = await request(f.app, path, {
        method: 'POST', headers: { 'content-type': contentType, 'x-csrf-token': 'valid-token' },
        body: '{"name":"normal"}',
      });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.received, { name: 'normal' });
    }
    assert.equal((await request(f.app, path)).status, 200);
  }
  assert.equal(f.mutations(), 4);
});

test('CSRF checks cover every mutating method, including DELETE', async () => {
  const f = apiFixture();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await request(f.app, '/API/accounts', {
      method, headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 403, method);
  }
  assert.equal(f.mutations(), 0);
});

test('compressed request bodies are rejected before decoding, and the app stays usable', async () => {
  const f = apiFixture();
  for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync]]) {
    const payload = Buffer.concat([compress(Buffer.from('{}')), Buffer.from('trailing-bytes')]);
    const response = await request(f.app, '/API/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': encoding, 'x-csrf-token': 'valid-token' },
      body: payload,
    });
    assert.equal(response.status, 415, encoding);
    assert.equal(response.body.type, 'encoding.unsupported');
  }
  assert.equal(f.mutations(), 0);
  assert.equal((await request(f.app, '/api/accounts')).status, 200);
});

test('malformed and oversized JSON are rejected before reaching business handlers', async () => {
  const f = apiFixture();
  const options = { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': 'valid-token' } };
  assert.equal((await request(f.app, '/api/accounts', { ...options, body: '{' })).status, 400);
  assert.equal((await request(f.app, '/api/accounts', {
    ...options, body: JSON.stringify({ data: 'x'.repeat(102400) }),
  })).status, 413);
  assert.equal(f.mutations(), 0);
});

function proxyFixture(trustedProxies) {
  const app = express();
  configureProxyTrust(app, trustedProxies);
  app.get('/', (req, res) => res.json({ ip: req.ip, secure: req.secure }));
  return app;
}

test('direct deployments ignore forged forwarding headers and rotating XFF cannot change the client IP', async () => {
  const app = proxyFixture('');
  for (let index = 1; index <= 7; index++) {
    const response = await request(app, '/', {
      headers: { 'x-forwarded-for': `198.51.100.${index}`, 'x-forwarded-proto': 'https' },
    });
    assert.deepEqual(response.body, { ip: '203.0.113.10', secure: false });
  }
});

test('only explicitly trusted proxy addresses can forward client IP and HTTPS information', async () => {
  const app = proxyFixture('127.0.0.1, ::1');
  const headers = { 'x-forwarded-for': '198.51.100.8', 'x-forwarded-proto': 'https' };
  assert.deepEqual((await request(app, '/', { headers, ip: '127.0.0.1' })).body,
    { ip: '198.51.100.8', secure: true });
  assert.deepEqual((await request(app, '/', { headers, ip: '203.0.113.10' })).body,
    { ip: '203.0.113.10', secure: false });
});
