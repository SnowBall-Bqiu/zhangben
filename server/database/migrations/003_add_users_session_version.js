module.exports = {
  id: '003_add_users_session_version',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(users)').all();
    if (cols.some((col) => col.name === 'session_version')) return;

    db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1');
  },
};
