import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend } from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { fetchMonthlyData } from '../api';
import { formatAmount } from '../utils/format';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend);

export default function Monthly() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchMonthlyData(year, month).then(setData).catch(() => setData(null));
  }, [year, month]);

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  const handleExport = () => {
    window.open('/api/transactions/export', '_blank');
  };

  // 日历数据
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const calendarDays = [];
  for (let i = 0; i < firstDayOfWeek; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  const dailyMap = {};
  if (data?.dailyStats) {
    data.dailyStats.forEach(d => {
      const day = parseInt(d.date.split('-')[2]);
      dailyMap[day] = d;
    });
  }

  // 柱状图数据
  const barData = data?.dailyStats?.length > 0 ? {
    labels: data.dailyStats.map(d => parseInt(d.date.split('-')[2]) + '日'),
    datasets: [
      { label: '收入', data: data.dailyStats.map(d => d.income), backgroundColor: '#7BC67E', borderRadius: 4 },
      { label: '支出', data: data.dailyStats.map(d => d.expense), backgroundColor: '#E88B8B', borderRadius: 4 },
    ]
  } : null;

  // 分类饼图
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
    <div className="monthly-page">
      <div className="page-header">
        <h1>月度账单</h1>
        <button className="btn-secondary" onClick={handleExport}>
          <Download size={16} /> 导出本月数据
        </button>
      </div>

      {/* 月份选择器 */}
      <div className="month-selector card">
        <button onClick={prevMonth}><ChevronLeft size={20} /></button>
        <h2>{year}年{month}月</h2>
        <button onClick={nextMonth}><ChevronRight size={20} /></button>
      </div>

      {data && (
        <>
          {/* 月度汇总 */}
          <div className="summary-cards grid-cards">
            <div className="card summary-card">
              <div className="summary-icon income"><ArrowDownLeft size={24} /></div>
              <div className="summary-info">
                <span className="summary-label">本月收入</span>
                <span className="amount amount-income">{formatAmount(data.summary.income)}</span>
              </div>
            </div>
            <div className="card summary-card">
              <div className="summary-icon expense"><ArrowUpRight size={24} /></div>
              <div className="summary-info">
                <span className="summary-label">本月支出</span>
                <span className="amount amount-expense">{formatAmount(data.summary.expense)}</span>
              </div>
            </div>
            <div className="card summary-card">
              <div className="summary-icon profit">
                <span style={{ fontSize: 24 }}>¥</span>
              </div>
              <div className="summary-info">
                <span className="summary-label">本月结余 / 盈利</span>
                <span className="summary-dual">
                  <span className={`amount ${data.summary.surplus >= 0 ? 'amount-income' : 'amount-expense'}`}>
                    {formatAmount(data.summary.surplus)}
                  </span>
                  <span className="summary-dual-sep">/</span>
                  <span className={`amount ${data.summary.profit >= 0 ? 'amount-income' : 'amount-expense'}`}>
                    {formatAmount(data.summary.profit)}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* 日历视图 */}
          <div className="card">
            <h3>每日收支</h3>
            <div className="calendar">
              {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                <div key={d} className="calendar-header">{d}</div>
              ))}
              {calendarDays.map((day, i) => (
                <div key={i} className={`calendar-day ${day ? '' : 'empty'} ${dailyMap[day] ? 'has-data' : ''}`}>
                  {day && (
                    <>
                      <span className="day-number">{day}</span>
                      {dailyMap[day] && (
                        <div className="day-amounts">
                          {dailyMap[day].income > 0 && <span className="day-income">+{formatAmount(dailyMap[day].income)}</span>}
                          {dailyMap[day].expense > 0 && <span className="day-expense">-{formatAmount(dailyMap[day].expense)}</span>}
                          {dailyMap[day].profit > 0 && <span className="day-profit">利{formatAmount(dailyMap[day].profit)}</span>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 图表 */}
          <div className="charts-row">
            {barData && (
              <div className="card chart-card">
                <h3>每日收支趋势</h3>
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

          {/* 分类明细 */}
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
        </>
      )}
    </div>
  );
}
