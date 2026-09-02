import { useState, useEffect } from 'react';
import { X, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { createTransaction, updateTransaction, fetchCategories, fetchAccounts } from '../api';
import { showToast } from './Toast';

function resolveIncomeKind(editData) {
  if (editData?.type !== 'income') return 'pure';
  if (editData.income_kind === 'business' || editData.income_kind === 'pure') {
    return editData.income_kind;
  }
  return editData.profit > 0 ? 'business' : 'pure';
}

export default function AddRecord({ onClose, onSuccess, editData }) {
  const [type, setType] = useState(editData?.type || 'expense');
  const [name, setName] = useState(editData?.name || '');
  const [amount, setAmount] = useState(editData?.amount?.toString() || '');
  const [categoryId, setCategoryId] = useState(editData?.category_id?.toString() || '');
  const [accountId, setAccountId] = useState(editData?.account_id?.toString() || '');
  const [note, setNote] = useState(editData?.note || '');
  const [incomeKind, setIncomeKind] = useState(resolveIncomeKind(editData));
  const [profit, setProfit] = useState(
    editData?.type === 'income' && editData?.profit > 0 ? editData.profit.toString() : ''
  );
  const [date, setDate] = useState(editData?.transaction_date?.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchCategories(type).then(d => setCategories(d.data)).catch(() => {});
    fetchAccounts().then(d => setAccounts(d.data)).catch(() => {});
  }, [type]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !amount || parseFloat(amount) <= 0) {
      showToast('请填写名称和金额', 'error');
      return;
    }
    if (type === 'income' && incomeKind === 'business' && profit && parseFloat(profit) < 0) {
      showToast('盈利金额不能为负', 'error');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        amount: parseFloat(amount),
        type,
        income_kind: type === 'income' ? incomeKind : null,
        profit: type === 'income' && incomeKind === 'business' && profit ? parseFloat(profit) : null,
        category_id: categoryId || null,
        account_id: accountId || null,
        note: note.trim() || null,
        transaction_date: date
      };
      if (editData) {
        await updateTransaction(editData.id, payload);
        showToast('修改成功');
      } else {
        await createTransaction(payload);
        showToast('记账成功');
      }
      onSuccess?.();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{editData ? '编辑账目' : '记一笔'}</h3>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="type-tabs">
          <button className={`type-tab ${type === 'expense' ? 'active expense' : ''}`} onClick={() => setType('expense')}>
            <ArrowUpRight size={16} /> 支出
          </button>
          <button className={`type-tab ${type === 'income' ? 'active income' : ''}`} onClick={() => setType('income')}>
            <ArrowDownLeft size={16} /> 收入
          </button>
        </div>

        <form onSubmit={handleSubmit} className="add-form">
          <div className="form-group">
            <label>名称</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="记账名称" maxLength={50} />
          </div>

          <div className="form-group">
            <label>金额 (¥)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" min="0.01" step="0.01" />
          </div>

          {type === 'income' && (
            <div className="form-group">
              <label>收入类型</label>
              <div className="kind-tabs">
                <button
                  type="button"
                  className={`kind-tab ${incomeKind === 'pure' ? 'active pure' : ''}`}
                  onClick={() => { setIncomeKind('pure'); setProfit(''); }}
                >
                  纯收入
                </button>
                <button
                  type="button"
                  className={`kind-tab ${incomeKind === 'business' ? 'active business' : ''}`}
                  onClick={() => setIncomeKind('business')}
                >
                  经营
                </button>
              </div>
              {incomeKind === 'business' && (
                <input
                  type="number"
                  value={profit}
                  onChange={e => setProfit(e.target.value)}
                  placeholder="盈利金额（可不填）"
                  min="0"
                  step="0.01"
                />
              )}
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>分类</label>
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                <option value="">选择分类</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>账户</label>
              <select value={accountId} onChange={e => setAccountId(e.target.value)}>
                <option value="">选择账户</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>日期</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>

          <div className="form-group">
            <label>备注</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="备注信息（可选）" rows={2} />
          </div>

          <button type="submit" className="btn-primary btn-full" disabled={loading}>
            {loading ? '保存中...' : (editData ? '保存修改' : '确认记账')}
          </button>
        </form>
      </div>
    </div>
  );
}
