const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Duplex } = require('node:stream');
const express = require('express');
const Database = require('better-sqlite3');
const transactionRoutes = require('../routes/transactions');

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, type TEXT, icon TEXT);
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, balance REAL);
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount REAL NOT NULL, type TEXT NOT NULL,
      profit REAL DEFAULT 0, income_kind TEXT, note TEXT, transaction_date TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id), account_id INTEGER REFERENCES accounts(id),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO categories VALUES (1, '经营', 'income', NULL), (2, '其他支出', 'expense', NULL);
    INSERT INTO accounts VALUES (1, '现金', 100), (2, '银行卡', 200);
  `);
  const app = express();
  app.set('db', db);
  app.use(express.json());
  app.use('/api/transactions', transactionRoutes);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: true, message: err.message });
  });

  function request(method, url, body) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const socket = new Duplex({
        read() {},
        write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
      });
      const req = new http.IncomingMessage(socket);
      req.method = method;
      req.url = `/api/transactions${url}`;
      const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
      req.headers = { host: 'memory.test', 'content-type': 'application/json', 'content-length': String(payload.length) };
      const res = new http.ServerResponse(req);
      res.assignSocket(socket);
      res.on('error', reject);
      res.on('finish', () => {
        const wire = Buffer.concat(chunks).toString();
        const responseBody = wire.slice(wire.indexOf('\r\n\r\n') + 4);
        resolve({ status: res.statusCode, body: responseBody ? JSON.parse(responseBody) : {} });
        socket.destroy();
      });
      app.handle(req, res);
      req.complete = true;
      req.push(payload);
      req.push(null);
    });
  }
  const row = id => db.prepare('SELECT * FROM transactions WHERE id=?').get(id);
  const balance = id => db.prepare('SELECT balance FROM accounts WHERE id=?').get(id).balance;
  return { db, request, row, balance };
}

function business(overrides = {}) {
  return {
    name: '经营收入', type: 'income', income_kind: 'business', amount: '100.00',
    transaction_date: '2026-11-08', category_id: 1, account_id: 1,
    ...overrides,
  };
}

test('cost determines server-side profit in cents and client profit is ignored', async t => {
  const { request, row, balance } = fixture(t);
  const response = await request('POST', '/', business({ amount: '0.30', cost: '0.10', profit: 'malicious-value' }));
  assert.equal(response.status, 200);
  assert.equal(row(response.body.id).profit, 0.2);
  assert.equal(balance(1), 100.3);
  const listing = await request('GET', '/', undefined);
  assert.equal(listing.body.data[0].profit, 0.2);
  assert.equal('cost' in listing.body.data[0], false);
});

test('zero cost, break-even and a loss are all valid business outcomes', async t => {
  const { request, row } = fixture(t);
  for (const [cost, expectedProfit] of [[0, 100], ['0.00', 100], ['100.00', 0], ['135.12', -35.12]]) {
    const response = await request('POST', '/', business({ cost, profit: '999.99' }));
    assert.equal(response.status, 200);
    assert.equal(row(response.body.id).profit, expectedProfit);
  }
  const boundary = await request('POST', '/', business({ amount: '0.01', cost: '999999999.99' }));
  assert.equal(boundary.status, 200);
  assert.equal(row(boundary.body.id).profit, -999999999.98);
});

test('invalid costs reject creates and edits without changing transactions or balances', async t => {
  const { db, request, row, balance } = fixture(t);
  const created = await request('POST', '/', business({ cost: '40.00' }));
  const original = row(created.body.id);
  const invalidCosts = [-0.01, '1.001', '1000000000', '', ' ', null, true, {}, [], [1], 'abc', '1e2'];
  for (const cost of invalidCosts) {
    const create = await request('POST', '/', business({ cost }));
    const edit = await request('PUT', `/${created.body.id}`, business({ cost, amount: '200.00' }));
    assert.equal(create.status, 400, JSON.stringify(cost));
    assert.equal(edit.status, 400, JSON.stringify(cost));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count, 1);
    assert.deepEqual(row(created.body.id), original);
    assert.equal(balance(1), 200);
    assert.equal(balance(2), 200);
  }
});

test('editing amount, cost and account maintains balances based on gross income', async t => {
  const { request, row, balance } = fixture(t);
  const created = await request('POST', '/', business({ cost: '40.00' }));
  const id = created.body.id;
  assert.equal(balance(1), 200);
  assert.equal(row(id).profit, 60);

  const costOnlyEdit = await request('PUT', `/${id}`, business({ cost: '140.00' }));
  assert.equal(costOnlyEdit.status, 200);
  assert.equal(row(id).profit, -40);
  assert.equal(balance(1), 200);

  const changedAccount = await request('PUT', `/${id}`, business({ amount: '80.25', cost: '90.40', account_id: 2 }));
  assert.equal(changedAccount.status, 200);
  assert.equal(row(id).profit, -10.15);
  assert.equal(balance(1), 100);
  assert.equal(balance(2), 280.25);

  const deleted = await request('DELETE', `/${id}`);
  assert.equal(deleted.status, 200);
  assert.equal(balance(1), 100);
  assert.equal(balance(2), 200);
});

test('legacy business payloads keep optional profit and can create and edit losses', async t => {
  const { request, row, balance } = fixture(t);
  for (const [profit, expected] of [[undefined, 0], [null, 0], ['', 0], [0, 0], ['25.20', 25.2], ['-15.75', -15.75]]) {
    const response = await request('POST', '/', business({ profit, account_id: null }));
    assert.equal(response.status, 200);
    assert.equal(row(response.body.id).profit, expected);
  }
  const created = await request('POST', '/', business({ profit: '-5.25' }));
  const edited = await request('PUT', `/${created.body.id}`, business({ amount: '50.00', profit: '-7.50' }));
  assert.equal(edited.status, 200);
  assert.equal(row(created.body.id).profit, -7.5);
  assert.equal(balance(1), 150);
});

test('pure income and expenses keep zero profit regardless of cost or profit fields', async t => {
  const { request, row, balance } = fixture(t);
  const pure = await request('POST', '/', business({ income_kind: 'pure', cost: 'not-used', profit: '-99.00' }));
  assert.equal(pure.status, 200);
  assert.equal(row(pure.body.id).profit, 0);
  const expense = await request('POST', '/', business({ type: 'expense', income_kind: undefined, category_id: 2, cost: -1, profit: '50.00' }));
  assert.equal(expense.status, 200);
  assert.equal(row(expense.body.id).profit, 0);
  assert.equal(row(expense.body.id).income_kind, null);
  assert.equal(balance(1), 100);
});
