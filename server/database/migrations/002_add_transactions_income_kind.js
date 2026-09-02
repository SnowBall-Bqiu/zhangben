module.exports = {
  id: '002_add_transactions_income_kind',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(transactions)').all();
    if (cols.some((col) => col.name === 'income_kind')) return;

    db.exec('ALTER TABLE transactions ADD COLUMN income_kind TEXT');
    db.exec(`
      UPDATE transactions SET income_kind = CASE
        WHEN type = 'income' AND profit > 0 THEN 'business'
        WHEN type = 'income' THEN 'pure'
        ELSE NULL
      END
    `);
  },
};
