const express = require('express');
const {
  validateType,
  validateName,
  validateOptionalText,
  parsePositiveInteger,
  parseOptionalPositiveInteger,
  parsePageLimit,
  parseAmount,
  validateDate,
  escapeLike,
} = require('../utils/validation');
const router = express.Router();

const TRANSACTION_TYPES = ['income', 'expense'];

// CSV 安全转义：防止公式注入 + 双引号转义
function csvSafe(val) {
  if (val == null) return '""';
  let s = String(val).replace(/"/g, '""');
  const normalized = s.replace(/^[\uFEFF\s\u0000-\u001F]+/, '');
  if (/^[=+\-@]/.test(normalized)) {
    s = `'${s}`;
  }
  return `"${s}"`;
}

function getTransactionPayload(db, body) {
  const type = validateType(body.type, TRANSACTION_TYPES, '类型');
  const name = validateName(body.name, '名称', 50);
  const amount = parseAmount(body.amount, '金额');
  const profit = body.profit != null && body.profit !== ''
    ? parseAmount(body.profit, '盈利金额')
    : amount;
  const transactionDate = validateDate(body.transaction_date);
  const note = validateOptionalText(body.note, '备注', 500);
  const categoryId = parseOptionalPositiveInteger(body.category_id, '分类ID');
  const accountId = parseOptionalPositiveInteger(body.account_id, '账户ID');

  if (categoryId) {
    const category = db.prepare('SELECT id, type FROM categories WHERE id = ?').get(categoryId);
    if (!category) {
      return { error: { status: 404, message: '分类不存在' } };
    }
    if (category.type !== type) {
      return { error: { status: 400, message: '分类类型与账目类型不一致' } };
    }
  }

  if (accountId) {
    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
    if (!account) {
      return { error: { status: 404, message: '账户不存在' } };
    }
  }

  return {
    data: {
      name,
      amount,
      type,
      profit,
      categoryId,
      accountId,
      note,
      transactionDate,
    },
  };
}

// GET /api/transactions - 获取账目列表（支持筛选、分页）
router.get('/', (req, res) => {
  const db = req.app.get('db');
  const { type, search, page = 1, limit = 20 } = req.query;
  const { pageNum, limitNum, offset } = parsePageLimit(page, limit);

  let where = 'WHERE 1=1';
  const params = [];

  if (type && type !== 'all') {
    const queryType = validateType(type, TRANSACTION_TYPES, '类型');
    where += ' AND t.type = ?';
    params.push(queryType);
  }
  if (search) {
    const keyword = validateOptionalText(search, '搜索关键词', 50);
    if (keyword) {
      where += " AND t.name LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(keyword)}%`);
    }
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
  const data = db.prepare(sql).all(...params, limitNum, offset);

  res.json({ data, total, page: pageNum, limit: limitNum });
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
  const { data, error } = getTransactionPayload(db, req.body);
  if (error) {
    return res.status(error.status).json({ error: true, message: error.message });
  }

  const insertTxn = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO transactions (name, amount, type, profit, category_id, account_id, note, transaction_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.name, data.amount, data.type, data.profit, data.categoryId, data.accountId, data.note, data.transactionDate);

    if (data.accountId) {
      const balanceDelta = data.type === 'income' ? data.amount : -data.amount;
      db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(balanceDelta, data.accountId);
    }

    return result.lastInsertRowid;
  });

  const id = insertTxn();
  res.json({ message: '记账成功', id });
});

// PUT /api/transactions/:id - 修改账目
router.put('/:id', (req, res) => {
  const db = req.app.get('db');
  const id = parsePositiveInteger(req.params.id, '账目ID');
  const { data, error } = getTransactionPayload(db, req.body);
  if (error) {
    return res.status(error.status).json({ error: true, message: error.message });
  }

  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: true, message: '记录不存在' });
  }

  const updateTxn = db.transaction(() => {
    // 回退旧账户余额（用旧的 amount）
    if (existing.account_id) {
      const oldDelta = existing.type === 'income' ? -existing.amount : existing.amount;
      db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(oldDelta, existing.account_id);
    }

    db.prepare(`
      UPDATE transactions SET name=?, amount=?, type=?, profit=?, category_id=?, account_id=?, note=?, transaction_date=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(data.name, data.amount, data.type, data.profit, data.categoryId, data.accountId, data.note, data.transactionDate, id);

    // 更新新账户余额（用新的 amount）
    if (data.accountId) {
      const newDelta = data.type === 'income' ? data.amount : -data.amount;
      db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(newDelta, data.accountId);
    }
  });

  updateTxn();
  res.json({ message: '修改成功' });
});

// DELETE /api/transactions/:id - 删除账目
router.delete('/:id', (req, res) => {
  const db = req.app.get('db');
  const id = parsePositiveInteger(req.params.id, '账目ID');

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
