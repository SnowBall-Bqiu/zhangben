const express = require('express');
const router = express.Router();

// GET /api/accounts
router.get('/', (req, res) => {
  const db = req.app.get('db');
  const data = db.prepare('SELECT * FROM accounts ORDER BY sort_order ASC, id ASC').all();
  res.json({ data });
});

// POST /api/accounts
router.post('/', (req, res) => {
  const db = req.app.get('db');
  const { name, type, icon } = req.body;
  if (!name || !type) {
    return res.status(400).json({ error: true, message: '账户名称和类型为必填' });
  }
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM accounts').get();
  const sort_order = (maxOrder.max || 0) + 1;
  const result = db.prepare('INSERT INTO accounts (name, type, icon, sort_order) VALUES (?, ?, ?, ?)').run(name, type, icon || null, sort_order);
  res.json({ message: '账户创建成功', id: result.lastInsertRowid });
});

// PUT /api/accounts/:id
router.put('/:id', (req, res) => {
  const db = req.app.get('db');
  const { id } = req.params;
  const { name, icon, sort_order } = req.body;
  db.prepare('UPDATE accounts SET name=COALESCE(?,name), icon=COALESCE(?,icon), sort_order=COALESCE(?,sort_order) WHERE id=?').run(name || null, icon || null, sort_order ?? null, id);
  res.json({ message: '账户修改成功' });
});

// PUT /api/accounts/reorder - 批量排序
router.put('/reorder', (req, res) => {
  const db = req.app.get('db');
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: true, message: '参数错误' });
  }
  const stmt = db.prepare('UPDATE accounts SET sort_order = ? WHERE id = ?');
  const reorder = db.transaction(() => {
    ids.forEach((id, index) => stmt.run(index + 1, id));
  });
  reorder();
  res.json({ message: '排序成功' });
});

// DELETE /api/accounts/:id
router.delete('/:id', (req, res) => {
  const db = req.app.get('db');
  const { id } = req.params;
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  res.json({ message: '账户删除成功' });
});

module.exports = router;
