const express = require('express');
const {
  validateType,
  validateName,
  validateOptionalText,
  parsePositiveInteger,
} = require('../utils/validation');
const router = express.Router();

const CATEGORY_TYPES = ['income', 'expense'];

// GET /api/categories
router.get('/', (req, res) => {
  const db = req.app.get('db');
  const { type } = req.query;
  let sql = 'SELECT * FROM categories';
  const params = [];
  if (type) {
    const categoryType = validateType(type, CATEGORY_TYPES, '分类类型');
    sql += ' WHERE type = ?';
    params.push(categoryType);
  }
  sql += ' ORDER BY sort_order ASC';
  const data = db.prepare(sql).all(...params);
  res.json({ data });
});

// POST /api/categories
router.post('/', (req, res) => {
  const db = req.app.get('db');
  const { name, type, icon } = req.body;
  const categoryName = validateName(name, '分类名称', 10);
  const categoryType = validateType(type, CATEGORY_TYPES, '分类类型');
  const categoryIcon = validateOptionalText(icon, '图标', 50);
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM categories WHERE type = ?').get(categoryType);
  const sort_order = (maxOrder.max || 0) + 1;
  const result = db.prepare('INSERT INTO categories (name, type, icon, sort_order) VALUES (?, ?, ?, ?)').run(categoryName, categoryType, categoryIcon, sort_order);
  res.json({ message: '分类创建成功', id: result.lastInsertRowid });
});

// PUT /api/categories/reorder - 批量排序
router.put('/reorder', (req, res) => {
  const db = req.app.get('db');
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: true, message: '排序参数错误' });
  }

  const parsedIds = ids.map(id => parsePositiveInteger(id, '分类ID'));
  if (new Set(parsedIds).size !== parsedIds.length) {
    return res.status(400).json({ error: true, message: '分类ID不能重复' });
  }
  const placeholders = parsedIds.map(() => '?').join(',');
  const existingCount = db.prepare(`SELECT COUNT(*) as count FROM categories WHERE id IN (${placeholders})`).get(...parsedIds).count;
  if (existingCount !== parsedIds.length) {
    return res.status(404).json({ error: true, message: '部分分类不存在' });
  }
  const stmt = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?');
  const reorder = db.transaction(() => {
    parsedIds.forEach((id, index) => {
      stmt.run(index + 1, id);
    });
  });
  reorder();
  res.json({ message: '排序成功' });
});

// PUT /api/categories/:id
router.put('/:id', (req, res) => {
  const db = req.app.get('db');
  const id = parsePositiveInteger(req.params.id, '分类ID');
  const { name, icon, sort_order } = req.body;

  const categoryName = name == null ? null : validateName(name, '分类名称', 10);
  const categoryIcon = icon == null ? null : validateOptionalText(icon, '图标', 50);
  const sortOrder = sort_order == null ? null : parsePositiveInteger(sort_order, '排序值');
  const result = db.prepare('UPDATE categories SET name=COALESCE(?,name), icon=COALESCE(?,icon), sort_order=COALESCE(?,sort_order) WHERE id=?').run(categoryName, categoryIcon, sortOrder, id);
  if (result.changes === 0) {
    return res.status(404).json({ error: true, message: '分类不存在' });
  }
  res.json({ message: '分类修改成功' });
});

// DELETE /api/categories/:id
router.delete('/:id', (req, res) => {
  const db = req.app.get('db');
  const id = parsePositiveInteger(req.params.id, '分类ID');
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: true, message: '分类不存在' });
  }
  res.json({ message: '分类删除成功' });
});

module.exports = router;
