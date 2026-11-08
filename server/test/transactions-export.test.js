const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Duplex } = require('node:stream');
const express = require('express');
const Database = require('better-sqlite3');
const transactionRoutes = require('../routes/transactions');

const CSV_HEADER = '\uFEFF名称,金额,类型,收入类型,盈亏,分类,账户,备注,日期\n';

// Exercise Express query parsing and the real router without opening a port.
function request(app, query = '') {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = new Duplex({
      read() {},
      write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
    });
    const req = new http.IncomingMessage(socket);
    req.method = 'GET';
    req.url = `/api/transactions/export${query}`;
    req.headers = { host: 'memory.test' };
    const res = new http.ServerResponse(req);
    res.assignSocket(socket);
    res.on('error', reject);
    res.on('finish', () => {
      const wire = Buffer.concat(chunks).toString('utf8');
      resolve({
        status: res.statusCode,
        headers: res.getHeaders(),
        body: wire.slice(wire.indexOf('\r\n\r\n') + 4),
      });
      socket.destroy();
    });
    app.handle(req, res);
    req.push(null);
  });
}

function fixture(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, name TEXT, amount REAL, type TEXT, profit REAL,
      income_kind TEXT, note TEXT, transaction_date TEXT, category_id INTEGER, account_id INTEGER
    );
    INSERT INTO categories VALUES (1, '餐饮');
    INSERT INTO accounts VALUES (1, '银行卡');
  `);
  const insert = db.prepare(`
    INSERT INTO transactions (name, amount, type, profit, note, transaction_date, category_id, account_id)
    VALUES (?, 12.5, 'expense', 0, ?, ?, 1, 1)
  `);
  const app = express();
  app.set('db', db);
  app.use('/api/transactions', transactionRoutes);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: true, message: err.message });
  });
  return { app, add: (name, date, note = null) => insert.run(name, note, date) };
}

function row(name, date) {
  return `"${name}",12.5,支出,,0,"餐饮","银行卡","","${date}"`;
}

test('monthly CSV includes both February boundaries in a leap year and excludes adjacent months', async t => {
  const { app, add } = fixture(t);
  add('previous-month-secret', '2024-01-31');
  add('month-first', '2024-02-01');
  add('month-last', '2024-02-29');
  add('next-month-secret', '2024-03-01');
  add('other-year-secret', '2023-02-10');

  const response = await request(app, '?year=2024&month=2');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/csv; charset=utf-8');
  assert.equal(response.headers['content-disposition'], 'attachment; filename=transactions-2024-02.csv');
  assert.equal(response.body, CSV_HEADER + [
    row('month-last', '2024-02-29'), row('month-first', '2024-02-01'),
  ].join('\n'));
});

test('December CSV stops at the start of the next year', async t => {
  const { app, add } = fixture(t);
  add('previous-month-secret', '2025-11-30');
  add('december-first', '2025-12-01');
  add('december-last', '2025-12-31');
  add('next-year-secret', '2026-01-01');

  const response = await request(app, '?year=2025&month=12');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-disposition'], 'attachment; filename=transactions-2025-12.csv');
  assert.equal(response.body, CSV_HEADER + [
    row('december-last', '2025-12-31'), row('december-first', '2025-12-01'),
  ].join('\n'));
});

test('an empty selected month exports only the header, including accepted year limits', async t => {
  const { app, add } = fixture(t);
  add('outside-month-secret', '2024-02-15');
  for (const query of ['?year=2024&month=3', '?year=1970&month=1', '?year=2100&month=12']) {
    const response = await request(app, query);
    assert.equal(response.status, 200, query);
    assert.equal(response.body, CSV_HEADER, query);
  }
});

test('omitting both month parameters preserves the full-history export', async t => {
  const { app, add } = fixture(t);
  add('older-entry', '2023-01-01');
  add('newer-entry', '2024-02-29');

  const response = await request(app);
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-disposition'], 'attachment; filename=transactions.csv');
  assert.equal(response.body, CSV_HEADER + [
    row('newer-entry', '2024-02-29'), row('older-entry', '2023-01-01'),
  ].join('\n'));
});

test('incomplete, malformed and non-scalar month parameters fail without exporting any history', async t => {
  const { app, add } = fixture(t);
  add('transaction-secret', '2024-02-15', 'private-note');
  const invalidQueries = [
    '?year=2024', '?month=2', '?year=', '?month=', '?year=&month=',
    '?year=&month=2', '?year=2024&month=',
    '?year=1969&month=2', '?year=2101&month=2', '?year=0&month=2',
    '?year=-2024&month=2', '?year=2024.5&month=2', '?year=2e3&month=2',
    '?year=02024&month=2', '?year=invalid&month=2',
    '?year=2024&month=0', '?year=2024&month=13', '?year=2024&month=-1',
    '?year=2024&month=2.5', '?year=2024&month=02', '?year=2024&month=invalid',
    '?year=2024&month=2&year=2024', '?year=2024&month=2&month=2',
    '?year[]=2024&month=2', '?year=2024&month[]=2',
    '?year[value]=2024&month=2', '?year=2024&month[value]=2',
    '?year=2024&month=2%20OR%201%3D1',
  ];
  for (const query of invalidQueries) {
    const response = await request(app, query);
    assert.equal(response.status, 400, query);
    assert.match(response.headers['content-type'], /^application\/json\b/, query);
    assert.equal(response.headers['content-disposition'], undefined, query);
    assert.equal(JSON.parse(response.body).error, true, query);
    assert.doesNotMatch(response.body, /transaction-secret|private-note|银行卡|名称,金额/, query);
  }
});

test('monthly filtering preserves CSV formula protection and quoted multiline fields', async t => {
  const { app, add } = fixture(t);
  add('=SUM(1,2)', '2024-02-15', 'line 1,\n"line 2"');

  const response = await request(app, '?year=2024&month=2');
  assert.equal(response.status, 200);
  assert.equal(response.body, CSV_HEADER +
    '"\'=SUM(1,2)",12.5,支出,,0,"餐饮","银行卡","line 1,\n""line 2""","2024-02-15"');
});
