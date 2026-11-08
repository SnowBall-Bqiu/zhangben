import { useState, useEffect, useId } from 'react';
import { X, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { createTransaction, updateTransaction, fetchCategories, fetchAccounts } from '../api';
import { showToast } from './Toast';
import { calculateBusinessProfit, moneyToCents, resolveIncomeKind, restoreBusinessCost } from '../utils/business-profit';

export default function AddRecord({ onClose, onSuccess, editData }) {
  const formId = useId();
  const [type, setType] = useState(editData?.type || 'expense');
  const [name, setName] = useState(editData?.name || '');
  const [amount, setAmount] = useState(editData?.amount?.toString() || '');
  const [categoryId, setCategoryId] = useState(editData?.category_id?.toString() || '');
  const [accountId, setAccountId] = useState(editData?.account_id?.toString() || '');
  const [note, setNote] = useState(editData?.note || '');
  const [incomeKind, setIncomeKind] = useState(resolveIncomeKind(editData));
  const [cost, setCost] = useState(() => restoreBusinessCost(editData));
  const profit = calculateBusinessProfit(amount, cost);
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
    if (!name.trim() || !amount) {
      showToast('请填写名称和金额', 'error');
      return;
    }
    const amountCents = moneyToCents(amount);
    if (amountCents === null || amountCents <= 0) {
      showToast('金额必须大于0，最多两位小数，且不超过999999999.99', 'error');
      return;
    }
    if (type === 'income' && incomeKind === 'business' && profit === null) {
      showToast('成本必须为非负金额，最多两位小数，且不超过999999999.99', 'error');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        amount: amountCents / 100,
        type,
        income_kind: type === 'income' ? incomeKind : null,
        ...(type === 'income' && incomeKind === 'business'
          ? { cost: moneyToCents(cost.trim() || '0') / 100 }
          : {}),
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
            <label htmlFor={`${formId}-amount`}>金额 (¥)</label>
            <input id={`${formId}-amount`} type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" min="0.01" max="999999999.99" step="0.01" />
          </div>

          {type === 'income' && (
            <div className="form-group">
              <label>收入类型</label>
              <div className="kind-tabs">
                <button
                  type="button"
                  className={`kind-tab ${incomeKind === 'pure' ? 'active pure' : ''}`}
                  onClick={() => setIncomeKind('pure')}
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
            </div>
          )}

          {type === 'income' && incomeKind === 'business' && (
            <div className="business-fields">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor={`${formId}-cost`}>成本金额 (¥)</label>
                  <input
                    id={`${formId}-cost`}
                    type="number"
                    value={cost}
                    onChange={e => setCost(e.target.value)}
                    placeholder="0.00（可不填）"
                    min="0"
                    max="999999999.99"
                    step="0.01"
                    aria-describedby={`${formId}-profit-hint`}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor={`${formId}-profit`}>盈利金额 (¥)</label>
                  <input
                    id={`${formId}-profit`}
                    type="text"
                    value={profit === null ? '' : profit.toFixed(2)}
                    placeholder="自动计算"
                    readOnly
                    className={`business-profit ${profit < 0 ? 'amount-expense' : 'amount-income'}`}
                    aria-describedby={`${formId}-profit-hint`}
                  />
                </div>
              </div>
              <p id={`${formId}-profit-hint`} className="label-hint">盈利 = 收入金额 − 总成本；成本不填按0计算，负数表示亏损。</p>
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
