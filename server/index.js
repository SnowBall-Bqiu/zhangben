const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDatabase, DB_PATH } = require('./database/init');
const Database = require('better-sqlite3');
const BetterSqlite3Store = require('./middleware/session-store');
const securityHeaders = require('./middleware/security-headers');
const { csrfMiddleware } = require('./middleware/csrf');

// 初始化数据库
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;
const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

app.disable('x-powered-by');

function requireJsonBodyForApiWrites(req, res, next) {
  if (!req.path.startsWith('/api/') || !mutatingMethods.has(req.method)) {
    return next();
  }

  if (req.is('application/json') || req.is('application/*+json')) {
    return next();
  }

  return res.status(415).json({ error: true, message: '写接口仅接受 JSON 请求' });
}

// 中间件
app.use(securityHeaders);
app.use(requireJsonBodyForApiWrites);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: true, message: '请求体格式错误' });
  }
  return next(err);
});

// Session 配置
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  if (!process.env.SESSION_SECRET) {
    throw new Error('生产环境必须设置 SESSION_SECRET');
  }
  app.set('trust proxy', 1);
}
app.use(session({
  name: isProduction ? '__Host-zhangben.sid' : 'zhangben.sid',
  store: new BetterSqlite3Store({ dbPath: path.join(__dirname, 'database', 'sessions.db') }),
  secret: process.env.SESSION_SECRET || 'zhangben-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7天
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/'
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

app.use('/api', csrfMiddleware);
app.use('/api/auth', authRoutes);
app.use('/api/transactions', authMiddleware, transactionRoutes);
app.use('/api/categories', authMiddleware, categoryRoutes);
app.use('/api/accounts', authMiddleware, accountRoutes);
app.use('/api/dashboard', authMiddleware, dashboardRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: true, message: '接口不存在' });
});

app.get('/robots.txt', (req, res) => {
  res.status(404).type('text/plain; charset=utf-8').send('未找到');
});

app.get('/manifest.json', (req, res) => {
  res.status(404).json({ error: true, message: '未找到' });
});

app.get('/.well-known/security.txt', (req, res) => {
  res.status(404).type('text/plain; charset=utf-8').send('未找到');
});

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
  if (res.headersSent) {
    return next(err);
  }

  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: true, message: '请求体格式错误' });
  }

  if (err && err.status === 400) {
    return res.status(400).json({ error: true, message: err.message || '参数错误' });
  }

  console.error('服务器错误:', err);
  res.status(500).json({ error: true, message: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`雪球账本服务已启动: http://localhost:${PORT}`);
});
