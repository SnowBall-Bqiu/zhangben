module.exports = {
  id: '001_add_accounts_sort_order',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(accounts)').all();
    if (cols.some((col) => col.name === 'sort_order')) return;

    db.exec('ALTER TABLE accounts ADD COLUMN sort_order INTEGER DEFAULT 0');
    db.exec('UPDATE accounts SET sort_order = id');
  },
};
