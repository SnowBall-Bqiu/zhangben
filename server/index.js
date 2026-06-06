const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDatabase, DB_PATH } = require('./database/init');
const Database = require('better-sqlite3');
const BetterSqlite3Store = require('./middleware/session-store');

// 初始化数据库
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session 配置
const isProduction = process.env.NODE_ENV === 'production';
app.use(session({
  store: new BetterSqlite3Store({ dbPath: path.join(__dirname, 'database', 'sessions.db') }),
  secret: process.env.SESSION_SECRET || 'zhangben-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7天
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction
  }
}));

// 数据库连接注入
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
app.set('db', db);

// 鉴权中间件
const authMiddleware = require('./middleware/auth');

// 路由
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const categoryRoutes = require('./routes/categories');
const accountRoutes = require('./routes/accounts');
const dashboardRoutes = require('./routes/dashboard');

app.use('/api/auth', authRoutes);
app.use('/api/transactions', authMiddleware, transactionRoutes);
app.use('/api/categories', authMiddleware, categoryRoutes);
app.use('/api/accounts', authMiddleware, accountRoutes);
app.use('/api/dashboard', authMiddleware, dashboardRoutes);

// 生产环境：托管前端静态文件
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ error: true, message: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`雪球账本服务已启动: http://localhost:${PORT}`);
});
