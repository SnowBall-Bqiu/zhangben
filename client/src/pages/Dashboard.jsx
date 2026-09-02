import { useState, useEffect } from 'react';
import { Plus, TrendingDown, TrendingUp, DollarSign, ArrowDownLeft, ArrowUpRight, Inbox } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend } from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';
import { fetchDashboardSummary, fetchDashboardTrend } from '../api';
import AddRecord from '../components/AddRecord';
import { formatAmount, formatDateTime } from '../utils/format';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend);

// Lucide 图标映射
const iconMap = {
  Utensils: () => <span>🍽</span>,
  Bus: () => <span>🚌</span>,
  ShoppingCart: () => <span>🛒</span>,
  Home: () => <span>🏠</span>,
  Droplets: () => <span>💧</span>,
  Shirt: () => <span>👕</span>,
  Gamepad2: () => <span>🎮</span>,
  Smartphone: () => <span>📱</span>,
  Pill: () => <span>💊</span>,
  BookOpen: () => <span>📖</span>,
  Wallet: () => <span>💰</span>,
  Briefcase: () => <span>💼</span>,
  Gift: () => <span>🎁</span>,
  Banknote: () => <span>💵</span>,
  TrendingUp: () => <span>📈</span>,
  RotateCcw: () => <span>↩</span>,
  Package: () => <span>📦</span>,
  Landmark: () => <span>🏦</span>,
  MessageCircle: () => <span>💬</span>,
};

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const loadData = () => {
    fetchDashboardSummary().then(setSummary).catch(() => {});
    fetchDashboardTrend().then(setTrend).catch(() => {});
  };

  useEffect(() => { loadData(); }, []);

  if (!summary) {
    return (
      <div className="page-loading">
        <div className="loading-dots"><span></span><span></span><span></span></div>
      </div>
    );
  }

  // 趋势图数据
  const lineData = trend ? {
    labels: trend.data.map(t => t.label),
    datasets: [
      {
        label: '收入',
        data: trend.data.map(t => t.income),
        borderColor: '#7BC67E',
        backgroundColor: 'rgba(123,198,126,0.1)',
        fill: true,
        tension: 0.4,
      },
      {
        label: '支出',
        data: trend.data.map(t => t.expense),
        borderColor: '#E88B8B',
        backgroundColor: 'rgba(232,139,139,0.1)',
        fill: true,
        tension: 0.4,
      },
      {
        label: '结余',
        data: trend.data.map(t => t.surplus),
        borderColor: '#E8B800',
        backgroundColor: 'rgba(232,184,0,0.1)',
        fill: true,
        tension: 0.4,
      },
      {
        label: '盈利',
        data: trend.data.map(t => t.profit),
        borderColor: '#6AAFE6',
        backgroundColor: 'rgba(106,175,230,0.1)',
        fill: true,
        tension: 0.4,
      }
    ]
  } : null;

  // 分类饼图数据
  const expenseCategories = summary.recentTransactions
    .filter(t => t.type === 'expense' && t.category_name)
    .reduce((acc, t) => {
      acc[t.category_name] = (acc[t.category_name] || 0) + t.amount;
      return acc;
    }, {});

  const pieData = Object.keys(expenseCategories).length > 0 ? {
    labels: Object.keys(expenseCategories),
    datasets: [{
      data: Object.values(expenseCategories),
      backgroundColor: ['#E88B8B', '#6AAFE6', '#E8B800', '#B48EE8', '#7BC67E', '#FF9F43', '#54A0FF', '#5F27CD', '#01CBC6', '#FF6B6B'],
      borderWidth: 2,
      borderColor: 'var(--bg-card)',
    }]
  } : null;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>首页</h1>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={18} /> 记一笔
        </button>
      </div>

      {/* 本月汇总 */}
      <div className="summary-cards grid-cards">
        <div className="card summary-card">
          <div className="summary-icon income"><TrendingDown size={24} /></div>
          <div className="summary-info">
            <span className="summary-label">本月收入</span>
            <span className="amount amount-income">{formatAmount(summary.month.income)}</span>
          </div>
        </div>
        <div className="card summary-card">
          <div className="summary-icon expense"><TrendingUp size={24} /></div>
          <div className="summary-info">
            <span className="summary-label">本月支出</span>
            <span className="amount amount-expense">{formatAmount(summary.month.expense)}</span>
          </div>
        </div>
        <div className="card summary-card">
          <div className="summary-icon profit"><DollarSign size={24} /></div>
          <div className="summary-info">
            <span className="summary-label">本月结余 / 盈利</span>
            <span className="summary-dual">
              <span className={`amount ${summary.month.surplus >= 0 ? 'amount-income' : 'amount-expense'}`}>
                {formatAmount(summary.month.surplus)}
              </span>
              <span className="summary-dual-sep">/</span>
              <span className={`amount ${summary.month.profit >= 0 ? 'amount-income' : 'amount-expense'}`}>
                {formatAmount(summary.month.profit)}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* 今日汇总 */}
      <div className="card today-card">
        <h3>今日收支</h3>
        <div className="today-row">
          <span className="today-item">
            <ArrowDownLeft size={16} className="icon-income" />
            收入 {formatAmount(summary.today.income)}
          </span>
          <span className="today-item">
            <ArrowUpRight size={16} className="icon-expense" />
            支出 {formatAmount(summary.today.expense)}
          </span>
        </div>
      </div>

      {/* 账户余额 */}
      <div className="card">
        <h3>账户余额</h3>
        <div className="accounts-row">
          {summary.accounts.map(a => (
            <div key={a.id} className="account-item">
              <span className="account-name">{a.name}</span>
              <span className="amount">{formatAmount(a.balance)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 图表区域 */}
      <div className="charts-row">
        {lineData && (
          <div className="card chart-card">
            <h3>收支趋势（近6个月）</h3>
            <div className="chart-container">
              <Line data={lineData} options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } },
                scales: { y: { beginAtZero: true } }
              }} />
            </div>
          </div>
        )}
        {pieData && (
          <div className="card chart-card">
            <h3>支出分类占比</h3>
            <div className="chart-container chart-pie">
              <Doughnut data={pieData} options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } }
              }} />
            </div>
          </div>
        )}
      </div>

      {/* 最近账目 */}
      <div className="card">
        <h3>最近账目</h3>
        {summary.recentTransactions.length === 0 ? (
          <div className="empty-state">
            <Inbox size={64} />
            <p>暂无记录</p>
            <p>快来记一笔吧！</p>
          </div>
        ) : (
          <div className="transaction-list">
            {summary.recentTransactions.map(t => (
              <div key={t.id} className="transaction-item">
                <div className="transaction-icon">
                  {t.category_icon && iconMap[t.category_icon] ? iconMap[t.category_icon]() : (t.type === 'income' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />)}
                </div>
                <div className="transaction-info">
                  <span className="transaction-name">{t.name}</span>
                  <span className="transaction-meta">
                    {t.category_name} · {formatDateTime(t.transaction_date)}
                    {t.type === 'income' && t.profit > 0 && <span className="profit-note"> · 盈利{formatAmount(t.profit)}</span>}
                  </span>
                </div>
                <span className={`amount ${t.type === 'income' ? 'amount-income' : 'amount-expense'}`}>
                  {t.type === 'income' ? '+' : '-'}{formatAmount(t.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && <AddRecord onClose={() => setShowAdd(false)} onSuccess={loadData} />}
    </div>
  );
}
