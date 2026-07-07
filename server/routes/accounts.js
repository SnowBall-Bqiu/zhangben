const express = require('express');
const {
  validateType,
  validateName,
  validateOptionalText,
  parsePositiveInteger,
  parseBalanceAmount,
} = require('../utils/validation');
const router = express.Router();

const ACCOUNT_TYPES = ['cash', 'bank', 'alipay', 'wechat', 'other'];

// GET /api/accounts
router.get('/', (req, res) => {
  const db = req.app.get('db');
  const data = db.prepare('SELECT * FROM accounts ORDER BY sort_order ASC, id ASC').all();
  res.json({ data });
});

// POST /api/accounts
router.post('/', (req, res) => {
  const db = req.app.get('db');
  const { name, type, icon, balance } = req.body;
  const accountName = validateName(name, '账户名称', 10);
  const accountType = validateType(type, ACCOUNT_TYPES, '账户类型');
  const accountIcon = validateOptionalText(icon, '图标', 50);
  const accountBalance = balance == null || balance === '' ? 0 : parseBalanceAmount(balance, '账户余额');
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM accounts').get();
  const sort_order = (maxOrder.max || 0) + 1;
  const result = db.prepare('INSERT INTO accounts (name, type, icon, balance, sort_order) VALUES (?, ?, ?, ?, ?)').run(accountName, accountType, accountIcon, accountBalance, sort_order);
  res.json({ message: '账户创建成功', id: result.lastInsertRowid });
});

// PUT /api/accounts/reorder - 批量排序
router.put('/reorder', (req, res) => {
  const db = req.app.get('db');
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: true, message: '排序参数错误' });
  }

  const parsedIds = ids.map(id => parsePositiveInteger(id, '账户ID'));
  if (new Set(parsedIds).size !== parsedIds.length) {
    return res.status(400).json({ error: true, message: '账户ID不能重复' });
  }
  const placeholders = parsedIds.map(() => '?').join(',');
  const existingCount = db.prepare(`SELECT COUNT(*) as count FROM accounts WHERE id IN (${placeholders})`).get(...parsedIds).count;
  if (existingCount !== parsedIds.length) {
    return res.status(404).json({ error: true, message: '部分账户不存在' });
  }
  const stmt = db.prepare('UPDATE accounts SET sort_order = ? WHERE id = ?');
  const reorder = db.transaction(() => {
    parsedIds.forEach((id, index) => {
      stmt.run(index + 1, id);
    });
  });
  reorder();
  res.json({ message: '排序成功' });
});

// PUT /api/accounts/:id
router.put('/:id', (req, res) => {
  const db = req.app.get('db');
  const id = parsePositiveInteger(req.params.id, '账户ID');
  const { name, icon, sort_order, balance } = req.body;
  const accountName = name == null ? null : validateName(name, '账户名称', 10);
  const accountIcon = icon == null ? null : validateOptionalText(icon, '图标', 50);
  const sortOrder = sort_order == null ? null : parsePositiveInteger(sort_order, '排序值');
  const accountBalance = balance == null || balance === '' ? null : parseBalanceAmount(balance, '账户余额');
  const result = db.prepare('UPDATE accounts SET name=COALESCE(?,name), icon=COALESCE(?,icon), sort_order=COALESCE(?,sort_order), balance=COALESCE(?,balance) WHERE id=?').run(accountName, accountIcon, sortOrder, accountBalance, id);
  if (result.changes === 0) {
    return res.status(404).json({ error: true, message: '账户不存在' });
  }
  res.json({ message: '账户修改成功' });
});

// DELETE /api/accounts/:id
router.delete('/:id', (req, res) => {
  const db = req.app.get('db');
  const id = parsePositiveInteger(req.params.id, '账户ID');
  const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: true, message: '账户不存在' });
  }
  res.json({ message: '账户删除成功' });
});

module.exports = router;
