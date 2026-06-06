const express = require('express');
const router = express.Router();

// CSV 安全转义：防止公式注入 + 双引号转义
function csvSafe(val) {
  if (val == null) return '""';
  const s = String(val).replace(/"/g, '""').replace(/^[=+\-@\t\r]/, "'$&");
  return `"${s}"`;
}

// GET /api/transactions - 获取账目列表（支持筛选、分页）
router.get('/', (req, res) => {
  const db = req.app.get('db');
  const { type, search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = 'WHERE 1=1';
  const params = [];

  if (type && type !== 'all') {
    where += ' AND t.type = ?';
    params.push(type);
  }
  if (search) {
    where += ' AND t.name LIKE ?';
    params.push(`%${search}%`);
  }

  const countSql = `SELECT COUNT(*) as total FROM transactions t ${where}`;
  const total = db.prepare(countSql).get(...params).total;

  const sql = `
    SELECT t.*, c.name as category_name, c.icon as category_icon, a.name as account_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN accounts a ON t.account_id = a.id
    ${where}
    ORDER BY t.transaction_date DESC, t.id DESC
    LIMIT ? OFFSET ?
  `;
  const data = db.prepare(sql).all(...params, parseInt(limit), offset);

  res.json({ data, total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/transactions/export - 导出CSV
router.get('/export', (req, res) => {
  const db = req.app.get('db');
  const rows = db.prepare(`
    SELECT t.name, t.amount, t.type, t.profit, t.note, t.transaction_date,
           c.name as category_name, a.name as account_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN accounts a ON t.account_id = a.id
    ORDER BY t.transaction_date DESC
  `).all();

  const BOM = '\uFEFF';
  const header = '名称,金额,类型,盈亏,分类,账户,备注,日期\n';
  const csv = rows.map(r =>
    `${csvSafe(r.name)},${r.amount},${r.type === 'income' ? '收入' : '支出'},${r.profit},${csvSafe(r.category_name)},${csvSafe(r.account_name)},${csvSafe(r.note)},${csvSafe(r.transaction_date)}`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');
  res.send(BOM + header + csv);
});

// POST /api/transactions - 新增账目
router.post('/', (req, res) => {
  const db = req.app.get('db');
  const { name, amount, type, profit: customProfit, category_id, account_id, note, transaction_date } = req.body;

  if (!name || !amount || !type || !transaction_date) {
    return res.status(400).json({ error: true, message: '参数错误：名称、金额、类型、日期为必填' });
  }

  const absAmount = Math.abs(amount);
  const profit = customProfit != null && customProfit !== ''
    ? Math.abs(customProfit)
    : absAmount;

  const insertTxn = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO transactions (name, amount, type, profit, category_id, account_id, note, transaction_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, absAmount, type, profit, category_id || null, account_id || null, note || null, transaction_date);

    if (account_id) {
      const balanceDelta = type === 'income' ? absAmount : -absAmount;
      db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(balanceDelta, account_id);
    }

    return result.lastInsertRowid;
  });

  const id = insertTxn();
  res.json({ message: '记账成功', id });
});

// PUT /api/transactions/:id - 修改账目
router.put('/:id', (req, res) => {
  const db = req.app.get('db');
  const { id } = req.params;
  const { name, amount, type, profit: customProfit, category_id, account_id, note, transaction_date } = req.body;

  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: true, message: '记录不存在' });
  }

  const absAmount = Math.abs(amount);
  const profit = customProfit != null && customProfit !== ''
    ? Math.abs(customProfit)
    : absAmount;

  const updateTxn = db.transaction(() => {
    // 回退旧账户余额（用旧的 amount）
    if (existing.account_id) {
      const oldDelta = existing.type === 'income' ? -existing.amount : existing.amount;
      db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(oldDelta, existing.account_id);
    }

    db.prepare(`
      UPDATE transactions SET name=?, amount=?, type=?, profit=?, category_id=?, account_id=?, note=?, transaction_date=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(name, absAmount, type, profit, category_id || null, account_id || null, note || null, transaction_date, id);

    // 更新新账户余额（用新的 amount）
    if (account_id) {
      const newDelta = type === 'income' ? absAmount : -absAmount;
      db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(newDelta, account_id);
    }
  });

  updateTxn();
  res.json({ message: '修改成功' });
});

// DELETE /api/transactions/:id - 删除账目
router.delete('/:id', (req, res) => {
  const db = req.app.get('db');
  const { id } = req.params;

  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: true, message: '记录不存在' });
  }

  const deleteTxn = db.transaction(() => {
    // 回退账户余额（用 amount）
    if (existing.account_id) {
      const delta = existing.type === 'income' ? -existing.amount : existing.amount;
      db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(delta, existing.account_id);
    }

    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  });

  deleteTxn();
  res.json({ message: '删除成功' });
});

module.exports = router;
