import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ArrowDownLeft, ArrowUpRight, DollarSign } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend } from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { fetchYearlyData } from '../api';
import { formatAmount } from '../utils/format';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

export default function Yearly() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchYearlyData(year).then(setData).catch(() => setData(null));
  }, [year]);

  const prevYear = () => setYear(y => y - 1);
  const nextYear = () => setYear(y => y + 1);

  const barData = data?.monthlyStats ? {
    labels: data.monthlyStats.map(m => m.label),
    datasets: [
      { label: '收入', data: data.monthlyStats.map(m => m.income), backgroundColor: '#7BC67E', borderRadius: 4 },
      { label: '支出', data: data.monthlyStats.map(m => m.expense), backgroundColor: '#E88B8B', borderRadius: 4 },
    ]
  } : null;

  const expenseCats = data?.categoryStats?.filter(c => c.type === 'expense') || [];
  const pieData = expenseCats.length > 0 ? {
    labels: expenseCats.map(c => c.name),
    datasets: [{
      data: expenseCats.map(c => c.total),
      backgroundColor: ['#E88B8B', '#6AAFE6', '#E8B800', '#B48EE8', '#7BC67E', '#FF9F43', '#54A0FF', '#5F27CD', '#01CBC6', '#FF6B6B'],
      borderWidth: 2,
      borderColor: 'var(--bg-card)',
    }]
  } : null;

  return (
    <div className="yearly-page">
      <div className="page-header">
        <h1>年度账单</h1>
      </div>

      <div className="month-selector card">
        <button onClick={prevYear}><ChevronLeft size={20} /></button>
        <h2>{year}年</h2>
        <button onClick={nextYear}><ChevronRight size={20} /></button>
      </div>

      {data && (
        <>
          <div className="summary-cards grid-cards">
            <div className="card summary-card">
              <div className="summary-icon income"><ArrowDownLeft size={24} /></div>
              <div className="summary-info">
                <span className="summary-label">全年收入</span>
                <span className="amount amount-income">{formatAmount(data.summary.income)}</span>
              </div>
            </div>
            <div className="card summary-card">
              <div className="summary-icon expense"><ArrowUpRight size={24} /></div>
              <div className="summary-info">
                <span className="summary-label">全年支出</span>
                <span className="amount amount-expense">{formatAmount(data.summary.expense)}</span>
              </div>
            </div>
            <div className="card summary-card">
              <div className="summary-icon profit"><DollarSign size={24} /></div>
              <div className="summary-info">
                <span className="summary-label">全年结余</span>
                <span className={`amount ${data.summary.profit >= 0 ? 'amount-income' : 'amount-expense'}`}>
                  {formatAmount(data.summary.profit)}
                </span>
              </div>
            </div>
          </div>

          <div className="charts-row">
            {barData && (
              <div className="card chart-card">
                <h3>月度收支趋势</h3>
                <div className="chart-container">
                  <Bar data={barData} options={{
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
                <h3>年度支出分类占比</h3>
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

          <div className="card">
            <h3>每月明细</h3>
            <div className="year-month-grid">
              {data.monthlyStats.map(m => (
                <div key={m.month} className={`year-month-item ${m.count > 0 ? 'has-data' : ''}`}>
                  <div className="year-month-title">{m.label}</div>
                  <div className="year-month-values">
                    <span className="amount-income">入 {formatAmount(m.income)}</span>
                    <span className="amount-expense">出 {formatAmount(m.expense)}</span>
                    <span>结 {formatAmount(m.income - m.expense)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {data.categoryStats.length > 0 && (
            <div className="card">
              <h3>分类明细</h3>
              <div className="category-stats">
                {data.categoryStats.map((c, i) => (
                  <div key={i} className="category-stat-item">
                    <span className="category-stat-name">{c.name}</span>
                    <span className="category-stat-count">{c.count}笔</span>
                    <span className={`amount ${c.type === 'income' ? 'amount-income' : 'amount-expense'}`}>
                      {formatAmount(c.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.accountStats.length > 0 && (
            <div className="card">
              <h3>账户流水</h3>
              <div className="category-stats">
                {data.accountStats.map((a, i) => (
                  <div key={i} className="category-stat-item">
                    <span className="category-stat-name">{a.name}</span>
                    <span className="category-stat-count">{a.count}笔</span>
                    <span className="yearly-account-flow">
                      <span className="amount amount-income">+{formatAmount(a.income)}</span>
                      <span className="amount amount-expense">-{formatAmount(a.expense)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
