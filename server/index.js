const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { readSecurityConfig } = require('./utils/security-config');
// Validate deployment settings before initializing or changing a database.
const securityConfig = readSecurityConfig();
const { initDatabase, DB_PATH, DATA_DIR } = require('./database/init');
const Database = require('better-sqlite3');
const BetterSqlite3Store = require('./middleware/session-store');
const securityHeaders = require('./middleware/security-headers');
const { csrfMiddleware } = require('./middleware/csrf');
const { requireJsonBodyForApiWrites, jsonBodyParser, configureProxyTrust, apiNoStore, enforcePublicAccess } = require('./middleware/request-security');
const { createApiRateLimit } = require('./middleware/api-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');
configureProxyTrust(app, securityConfig.trustedProxies);

// Initialize only after deployment and proxy settings have been validated.
initDatabase();

// 中间件
app.use(securityHeaders);
app.use('/api', apiNoStore);
app.use(enforcePublicAccess(securityConfig));
app.use('/api', createApiRateLimit());
app.use('/api/auth/csrf', createApiRateLimit({ windowMs: 5 * 60000, maxRequests: 20 }));
app.use('/api', requireJsonBodyForApiWrites, jsonBodyParser);

app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: true, message: '请求体格式错误' });
  }
  return next(err);
});

// Session 配置
const secureSessionCookie = securityConfig.secureCookie;
app.use(session({
  name: secureSessionCookie ? '__Host-zhangben.sid' : 'zhangben.sid',
  store: new BetterSqlite3Store({ dbPath: path.join(DATA_DIR, 'sessions.db') }),
  secret: securityConfig.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 小时，鉴权另有空闲和绝对过期检查
    httpOnly: true,
    sameSite: 'lax',
    secure: secureSessionCookie,
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

  if (err && err.status === 415) {
    return res.status(415).json({ error: true, message: '不支持该请求编码或内容类型' });
  }

  if (err && err.status === 413) {
    return res.status(413).json({ error: true, message: '请求内容过大' });
  }

  console.error('服务器错误:', err);
  res.status(500).json({ error: true, message: '服务器内部错误' });
});

const server = http.createServer({
  headersTimeout: 10000,
  requestTimeout: 15000,
  keepAliveTimeout: 5000,
  maxHeaderSize: 16384,
}, app);
server.maxRequestsPerSocket = 1000;
server.maxConnections = 256;
server.listen(PORT, HOST, () => {
  console.log(`雪球账本服务已启动: http://${HOST}:${PORT}`);
});
