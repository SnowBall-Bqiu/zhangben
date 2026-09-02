const express = require('express');
const { parsePositiveInteger } = require('../utils/validation');
const router = express.Router();

const SUMMARY_SELECT = `
  COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as income,
  COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expense,
  COALESCE(SUM(profit), 0) as profit,
  COALESCE(SUM(CASE WHEN type='income' AND income_kind='pure' THEN amount ELSE 0 END), 0) as pure_income
`;

function withSurplus(row) {
  const profit = row.profit || 0;
  const pureIncome = row.pure_income || 0;
  const expense = row.expense || 0;
  return { ...row, surplus: profit + pureIncome - expense };
}

// GET /api/dashboard/summary - 首页汇总数据
router.get('/summary', (req, res) => {
  const db = req.app.get('db');

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const today = `${year}-${month}-${String(now.getDate()).padStart(2, '0')}`;
  const monthStart = `${year}-${month}-01`;
  const monthEnd = `${year}-${month}-31`;

  // 本月汇总
  const monthSummary = withSurplus(db.prepare(`
    SELECT ${SUMMARY_SELECT}
    FROM transactions
    WHERE transaction_date >= ? AND transaction_date <= ?
  `).get(monthStart, monthEnd));

  // 今日汇总
  const todaySummary = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expense
    FROM transactions
    WHERE transaction_date LIKE ?
  `).get(`${today}%`);

  // 最近账目
  const recentTransactions = db.prepare(`
    SELECT t.*, c.name as category_name, c.icon as category_icon, a.name as account_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN accounts a ON t.account_id = a.id
    ORDER BY t.transaction_date DESC, t.id DESC
    LIMIT 10
  `).all();

  // 账户余额
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY id ASC').all();

  res.json({
    month: monthSummary,
    today: todaySummary,
    recentTransactions,
    accounts
  });
});

// GET /api/dashboard/trend - 收支趋势数据（近6个月）
router.get('/trend', (req, res) => {
  const db = req.app.get('db');

  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    months.push({ label: `${y}年${m}月`, start: `${y}-${m}-01`, end: `${y}-${m}-31` });
  }

  const trend = months.map(m => {
    const row = withSurplus(db.prepare(`
      SELECT ${SUMMARY_SELECT}
      FROM transactions
      WHERE transaction_date >= ? AND transaction_date <= ?
    `).get(m.start, m.end));
    return { label: m.label, income: row.income, expense: row.expense, profit: row.profit, surplus: row.surplus, pure_income: row.pure_income };
  });

  res.json({ data: trend });
});

// GET /api/dashboard/monthly - 月度账单数据
router.get('/monthly', (req, res) => {
  const db = req.app.get('db');
  const { year, month } = req.query;

  if (!year || !month) {
    return res.status(400).json({ error: true, message: '请提供年份和月份' });
  }

  const yearNum = parsePositiveInteger(year, '年份');
  const monthNum = parsePositiveInteger(month, '月份');
  if (yearNum < 1970 || yearNum > 2100) {
    return res.status(400).json({ error: true, message: '年份必须在 1970 到 2100 之间' });
  }
  if (monthNum < 1 || monthNum > 12) {
    return res.status(400).json({ error: true, message: '月份必须在 1 到 12 之间' });
  }

  const monthStr = String(monthNum).padStart(2, '0');
  const lastDay = new Date(yearNum, monthNum, 0).getDate();
  const monthStart = `${yearNum}-${monthStr}-01`;
  const monthEnd = `${yearNum}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  // 月度汇总
  const summary = withSurplus(db.prepare(`
    SELECT ${SUMMARY_SELECT}
    FROM transactions
    WHERE transaction_date >= ? AND transaction_date <= ?
  `).get(monthStart, monthEnd));

  // 分类统计
  const categoryStats = db.prepare(`
    SELECT c.name, c.icon, c.type,
      SUM(t.amount) as total,
      COUNT(t.id) as count
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE t.transaction_date >= ? AND t.transaction_date <= ?
    GROUP BY c.id
    ORDER BY total DESC
  `).all(monthStart, monthEnd);

  // 每日收支
  const dailyStats = db.prepare(`
    SELECT
      SUBSTR(transaction_date, 1, 10) as date,
      COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expense,
      COALESCE(SUM(CASE WHEN type='income' THEN profit ELSE 0 END), 0) as profit
    FROM transactions
    WHERE transaction_date >= ? AND transaction_date <= ?
    GROUP BY SUBSTR(transaction_date, 1, 10)
    ORDER BY date ASC
  `).all(monthStart, monthEnd);

  res.json({ summary, categoryStats, dailyStats });
});

// GET /api/dashboard/yearly - 年度账单数据
router.get('/yearly', (req, res) => {
  const db = req.app.get('db');
  const { year } = req.query;

  if (!year) {
    return res.status(400).json({ error: true, message: '请提供年份' });
  }

  const yearNum = parsePositiveInteger(year, '年份');
  if (yearNum < 1970 || yearNum > 2100) {
    return res.status(400).json({ error: true, message: '年份必须在 1970 到 2100 之间' });
  }

  const yearStart = `${yearNum}-01-01`;
  const yearEnd = `${yearNum}-12-31`;

  const summary = withSurplus(db.prepare(`
    SELECT ${SUMMARY_SELECT}
    FROM transactions
    WHERE transaction_date >= ? AND transaction_date <= ?
  `).get(yearStart, yearEnd));

  const rawMonthlyStats = db.prepare(`
    SELECT
      SUBSTR(transaction_date, 6, 2) as month,
      ${SUMMARY_SELECT},
      COUNT(id) as count
    FROM transactions
    WHERE transaction_date >= ? AND transaction_date <= ?
    GROUP BY SUBSTR(transaction_date, 6, 2)
    ORDER BY month ASC
  `).all(yearStart, yearEnd);

  const monthlyByMonth = new Map(rawMonthlyStats.map(item => [Number(item.month), item]));
  const monthlyStats = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const row = monthlyByMonth.get(month);
    const filled = withSurplus({
      income: row?.income || 0,
      expense: row?.expense || 0,
      profit: row?.profit || 0,
      pure_income: row?.pure_income || 0,
    });
    return {
      month,
      label: `${month}月`,
      income: filled.income,
      expense: filled.expense,
      profit: filled.profit,
      pure_income: filled.pure_income,
      surplus: filled.surplus,
      count: row?.count || 0,
    };
  });

  const categoryStats = db.prepare(`
    SELECT c.name, c.icon, c.type,
      SUM(t.amount) as total,
      COUNT(t.id) as count
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE t.transaction_date >= ? AND t.transaction_date <= ?
    GROUP BY c.id
    ORDER BY total DESC
  `).all(yearStart, yearEnd);

  const accountStats = db.prepare(`
    SELECT a.name, a.type,
      COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END), 0) as income,
      COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END), 0) as expense,
      COUNT(t.id) as count
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id
    WHERE t.transaction_date >= ? AND t.transaction_date <= ?
    GROUP BY a.id
    ORDER BY count DESC, a.sort_order ASC, a.id ASC
  `).all(yearStart, yearEnd);

  res.json({ summary, monthlyStats, categoryStats, accountStats });
});

module.exports = router;
