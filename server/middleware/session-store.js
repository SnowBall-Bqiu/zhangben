const session = require('express-session');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class BetterSqlite3Store extends session.Store {
  constructor(options = {}) {
    super();
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'database');
    const dbPath = options.dbPath || path.join(dataDir, 'sessions.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.maxSessions = options.maxSessions || 10000;
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired INTEGER
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired)');
    this.cleanup();
    this.cleanupTimer = setInterval(() => this.cleanup(), 60000);
    this.cleanupTimer.unref();
  }

  get(sid, callback) {
    try {
      const now = Date.now();
      const row = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?').get(sid, now);
      if (!row) return callback(null, null);
      callback(null, JSON.parse(row.sess));
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const configuredMaxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 8 * 60 * 60 * 1000;
      const maxAge = sess.userId ? configuredMaxAge : Math.min(configuredMaxAge, 10 * 60 * 1000);
      const expired = Date.now() + maxAge;
      const exists = this.db.prepare('SELECT sid FROM sessions WHERE sid = ?').get(sid);
      if (!exists && this.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count >= this.maxSessions) {
        this.cleanup();
        if (this.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count >= this.maxSessions) {
          return callback(new Error('Session capacity reached'));
        }
      }
      this.db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)').run(sid, JSON.stringify(sess), expired);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  cleanup() {
    try {
      this.db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now());
    } catch {}
  }

  close() {
    clearInterval(this.cleanupTimer);
    this.db.close();
  }
}

module.exports = BetterSqlite3Store;
