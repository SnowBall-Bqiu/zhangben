import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Search, Inbox, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { fetchTransactions, deleteTransaction } from '../api';
import { showToast } from '../components/Toast';
import AddRecord from '../components/AddRecord';
import { formatAmount, formatDate } from '../utils/format';

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const loadData = () => {
    const params = { page, limit: 20 };
    if (type !== 'all') params.type = type;
    if (search.trim()) params.search = search.trim();
    fetchTransactions(params)
      .then(d => { setTransactions(d.data); setTotal(d.total); })
      .catch(() => {});
  };

  useEffect(() => { loadData(); }, [page, type]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    loadData();
  };

  const handleDelete = async (id) => {
    try {
      await deleteTransaction(id);
      showToast('删除成功');
      setConfirmDelete(null);
      loadData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleExport = () => {
    window.open('/api/transactions/export', '_blank');
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="transactions-page">
      <div className="page-header">
        <h1>账单</h1>
        <div className="page-actions">
          <button className="btn-secondary" onClick={handleExport}>导出CSV</button>
          <button className="btn-primary" onClick={() => { setEditItem(null); setShowAdd(true); }}>
            <Plus size={18} /> 新增
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="filter-bar">
        <div className="filter-tabs">
          <button className={`filter-tab ${type === 'all' ? 'active' : ''}`} onClick={() => { setType('all'); setPage(1); }}>全部</button>
          <button className={`filter-tab ${type === 'income' ? 'active' : ''}`} onClick={() => { setType('income'); setPage(1); }}>收入</button>
          <button className={`filter-tab ${type === 'expense' ? 'active' : ''}`} onClick={() => { setType('expense'); setPage(1); }}>支出</button>
        </div>
        <form onSubmit={handleSearch} className="search-form">
          <Search size={16} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索账目名称..."
          />
        </form>
      </div>

      {/* 账目列表 */}
      {transactions.length === 0 ? (
        <div className="empty-state">
          <Inbox size={64} />
          <p>还没有记录，快来记一笔吧！</p>
        </div>
      ) : (
        <div className="card">
          <div className="transaction-list">
            {transactions.map(t => (
              <div key={t.id} className="transaction-item">
                <div className="transaction-icon">
                  {t.type === 'income' ? <ArrowDownLeft size={18} className="icon-income" /> : <ArrowUpRight size={18} className="icon-expense" />}
                </div>
                <div className="transaction-info">
                  <span className="transaction-name">{t.name}</span>
                  <span className="transaction-meta">
                    {t.category_name && `${t.category_name} · `}
                    {t.account_name && `${t.account_name} · `}
                    {formatDate(t.transaction_date)}
                    {t.type === 'income' && t.profit > 0 && <span className="profit-note"> · 盈利{formatAmount(t.profit)}</span>}
                  </span>
                </div>
                <span className={`amount ${t.type === 'income' ? 'amount-income' : 'amount-expense'}`}>
                  {t.type === 'income' ? '+' : '-'}{formatAmount(t.amount)}
                </span>
                <div className="transaction-actions">
                  <button className="btn-icon" onClick={() => { setEditItem(t); setShowAdd(true); }} title="编辑">
                    <Pencil size={16} />
                  </button>
                  {confirmDelete === t.id ? (
                    <div className="confirm-delete">
                      <span>确认删除？</span>
                      <button className="btn-danger-sm" onClick={() => handleDelete(t.id)}>是</button>
                      <button className="btn-secondary-sm" onClick={() => setConfirmDelete(null)}>否</button>
                    </div>
                  ) : (
                    <button className="btn-icon btn-icon-danger" onClick={() => setConfirmDelete(t.id)} title="删除">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
              <span>{page} / {totalPages}</span>
              <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <AddRecord
          editData={editItem}
          onClose={() => { setShowAdd(false); setEditItem(null); }}
          onSuccess={loadData}
        />
      )}
    </div>
  );
}
