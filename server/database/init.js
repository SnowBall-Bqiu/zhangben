const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'zhangben.db');

function initDatabase() {
  const db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 创建用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT,
      must_change_password INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 创建分类表
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 创建账户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('cash', 'bank', 'alipay', 'wechat', 'other')),
      balance REAL DEFAULT 0,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 兼容旧表：给 accounts 加 sort_order 列
  const accountCols = db.prepare("PRAGMA table_info(accounts)").all();
  if (!accountCols.some(c => c.name === 'sort_order')) {
    db.exec('ALTER TABLE accounts ADD COLUMN sort_order INTEGER DEFAULT 0');
    db.exec('UPDATE accounts SET sort_order = id');
  }

  // 创建账目表
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER,
      account_id INTEGER,
      name TEXT NOT NULL,
      note TEXT,
      amount REAL NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      profit REAL DEFAULT 0,
      transaction_date DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )
  `);

  // 创建索引
  db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)');

  // 插入默认用户 admin/123456
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existingUser) {
    const hash = bcrypt.hashSync('123456', 10);
    db.prepare('INSERT INTO users (username, password_hash, nickname, must_change_password) VALUES (?, ?, ?, ?)').run('admin', hash, '管理员', 1);
    console.log('默认用户 admin/123456 创建成功');
  }

  // 插入默认支出分类
  const expenseCount = db.prepare('SELECT COUNT(*) as count FROM categories WHERE type = ?').get('expense');
  if (expenseCount.count === 0) {
    const insertCategory = db.prepare('INSERT INTO categories (name, type, icon, sort_order) VALUES (?, ?, ?, ?)');
    const expenseCategories = [
      ['餐饮', 'expense', 'Utensils', 1],
      ['交通', 'expense', 'Bus', 2],
      ['购物', 'expense', 'ShoppingCart', 3],
      ['居住', 'expense', 'Home', 4],
      ['日用', 'expense', 'Droplets', 5],
      ['服饰', 'expense', 'Shirt', 6],
      ['娱乐', 'expense', 'Gamepad2', 7],
      ['通讯', 'expense', 'Smartphone', 8],
      ['医疗', 'expense', 'Pill', 9],
      ['教育', 'expense', 'BookOpen', 10],
    ];
    for (const cat of expenseCategories) {
      insertCategory.run(...cat);
    }
    console.log('支出分类种子数据插入成功');
  }

  // 插入默认收入分类
  const incomeCount = db.prepare('SELECT COUNT(*) as count FROM categories WHERE type = ?').get('income');
  if (incomeCount.count === 0) {
    const insertCategory = db.prepare('INSERT INTO categories (name, type, icon, sort_order) VALUES (?, ?, ?, ?)');
    const incomeCategories = [
      ['工资', 'income', 'Wallet', 1],
      ['兼职', 'income', 'Briefcase', 2],
      ['奖金', 'income', 'Gift', 3],
      ['红包', 'income', 'Banknote', 4],
      ['投资收益', 'income', 'TrendingUp', 5],
      ['退款', 'income', 'RotateCcw', 6],
      ['其他', 'income', 'Package', 7],
    ];
    for (const cat of incomeCategories) {
      insertCategory.run(...cat);
    }
    console.log('收入分类种子数据插入成功');
  }

  // 插入默认账户
  const accountCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get();
  if (accountCount.count === 0) {
    const insertAccount = db.prepare('INSERT INTO accounts (name, type, icon) VALUES (?, ?, ?)');
    const defaultAccounts = [
      ['现金', 'cash', 'Banknote'],
      ['银行卡', 'bank', 'Landmark'],
      ['支付宝', 'alipay', 'Smartphone'],
      ['微信', 'wechat', 'MessageCircle'],
    ];
    for (const acc of defaultAccounts) {
      insertAccount.run(...acc);
    }
    console.log('默认账户种子数据插入成功');
  }

  db.close();
  console.log('数据库初始化完成');
}

// 直接运行时初始化
if (require.main === module) {
  initDatabase();
}

module.exports = { initDatabase, DB_PATH };
