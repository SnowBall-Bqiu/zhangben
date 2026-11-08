const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { initDatabase } = require('../database/init');

function fixture(t, password) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const tempDir = fs.mkdtempSync(path.join(tempRoot, 'zhangben-init-test-'));
  const dbPath = path.join(tempDir, 'nested', 'ledger.db');
  const previousPassword = process.env.INITIAL_ADMIN_PASSWORD;
  if (password === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = password;
  t.after(() => {
    if (previousPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
    else process.env.INITIAL_ADMIN_PASSWORD = previousPassword;
    assert.equal(path.dirname(path.resolve(tempDir)), tempRoot);
    assert.ok(path.basename(tempDir).startsWith('zhangben-init-test-'));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const logs = [];
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  return { dbPath, logs, initialize: () => initDatabase({ dbPath }) };
}

function withDatabase(dbPath, action) {
  const db = new Database(dbPath);
  try {
    return action(db);
  } finally {
    db.close();
  }
}

function readState(dbPath) {
  return withDatabase(dbPath, db => ({
    users: db.prepare('SELECT * FROM users ORDER BY id').all(),
    categories: db.prepare('SELECT * FROM categories ORDER BY id').all(),
    accounts: db.prepare('SELECT * FROM accounts ORDER BY id').all(),
    migrations: db.prepare('SELECT * FROM schema_migrations ORDER BY id').all(),
  }));
}

test('a new database gets a random temporary password only once and initialization is repeatable', t => {
  const { dbPath, logs, initialize } = fixture(t);
  assert.equal(fs.existsSync(path.dirname(dbPath)), false);
  initialize();
  const state = readState(dbPath);
  assert.equal(state.users.length, 1);
  const admin = state.users[0];
  assert.equal(admin.username, 'admin');
  assert.equal(admin.must_change_password, 1);
  assert.equal(admin.session_version, 1);
  assert.equal(bcrypt.compareSync('123456', admin.password_hash), false);
  const credentialLogs = logs.filter(line => line.includes('临时密码：'));
  assert.equal(credentialLogs.length, 1);
  const password = credentialLogs[0].match(/临时密码：([A-Za-z0-9_-]{32})。/)[1];
  assert.equal(bcrypt.compareSync(password, admin.password_hash), true);
  assert.equal(state.categories.length, 17);
  assert.equal(state.accounts.length, 4);

  initialize();
  assert.deepEqual(readState(dbPath), state);
  assert.equal(logs.filter(line => line.includes('临时密码：')).length, 1);
});

test('renaming the administrator and restarting does not recreate admin or reset credentials', t => {
  const { dbPath, initialize } = fixture(t, 'bootstrap-password-123');
  initialize();
  const ownerHash = bcrypt.hashSync('owner-private-password', 4);
  withDatabase(dbPath, db => {
    db.prepare(`UPDATE users SET username=?, password_hash=?, must_change_password=0, session_version=4
      WHERE username='admin'`).run('renamed_owner', ownerHash);
  });
  const state = readState(dbPath);
  // Bootstrap settings cannot reset an established installation, even if later misconfigured.
  process.env.INITIAL_ADMIN_PASSWORD = '123456';
  initialize();
  assert.deepEqual(readState(dbPath), state);
  assert.equal(state.users.length, 1);
  assert.equal(state.users[0].username, 'renamed_owner');
  assert.equal(state.users[0].password_hash, ownerHash);
  assert.equal(state.users[0].must_change_password, 0);
  assert.equal(state.users[0].session_version, 4);
});

test('an explicit initial password is hashed, enforced once, and excluded from logs', t => {
  const password = 'configured-bootstrap-secret-123';
  const { dbPath, logs, initialize } = fixture(t, password);
  initialize();
  const state = readState(dbPath);
  assert.equal(bcrypt.compareSync(password, state.users[0].password_hash), true);
  assert.equal(state.users[0].must_change_password, 1);
  assert.equal(logs.some(line => line.includes(password)), false);
  assert.equal(logs.some(line => line.includes('临时密码：')), false);
  process.env.INITIAL_ADMIN_PASSWORD = 'another-bootstrap-secret-456';
  initialize();
  assert.deepEqual(readState(dbPath), state);
});

test('existing legacy accounts and hashes survive initialization without deletion', t => {
  const { dbPath, initialize } = fixture(t);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  withDatabase(dbPath, db => {
    db.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      nickname TEXT, must_change_password INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    const insert = db.prepare('INSERT INTO users (id, username, password_hash, must_change_password) VALUES (?, ?, ?, ?)');
    insert.run(1, 'renamed_owner', 'owner-existing-hash', 0);
    insert.run(2, 'admin', 'historical-admin-existing-hash', 1);
  });
  initialize();
  assert.deepEqual(readState(dbPath).users.map(user => ({
    id: user.id, username: user.username, hash: user.password_hash,
    mustChangePassword: user.must_change_password, sessionVersion: user.session_version,
  })), [
    { id: 1, username: 'renamed_owner', hash: 'owner-existing-hash', mustChangePassword: 0, sessionVersion: 1 },
    { id: 2, username: 'admin', hash: 'historical-admin-existing-hash', mustChangePassword: 1, sessionVersion: 1 },
  ]);
});

test('invalid configured initial passwords fail without creating a user and can be corrected', async t => {
  const invalidPasswords = [
    { label: 'too short', value: '123456' },
    { label: 'below 15 character minimum', value: 'a'.repeat(14) },
    { label: 'Unicode characters counted as code points', value: '🔒'.repeat(14) },
    { label: 'only spaces', value: ' '.repeat(12) },
    { label: 'over bcrypt byte limit', value: 'a'.repeat(73) },
    { label: 'multibyte over bcrypt byte limit', value: '密'.repeat(25) },
  ];
  for (const { label, value } of invalidPasswords) {
    await t.test(label, child => {
      const { dbPath, initialize } = fixture(child, value);
      assert.throws(initialize, /INITIAL_ADMIN_PASSWORD/);
      assert.equal(readState(dbPath).users.length, 0);
      process.env.INITIAL_ADMIN_PASSWORD = 'corrected-bootstrap-password';
      initialize();
      assert.equal(readState(dbPath).users.length, 1);
    });
  }
});
