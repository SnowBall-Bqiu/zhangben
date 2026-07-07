import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { User, Key, Tags, WalletCards, Plus, Trash2, GripVertical, X, Check } from 'lucide-react';
import { updateProfile, changePassword, fetchCategories, createCategory, updateCategory, deleteCategory, reorderCategories, fetchAccounts, createAccount, updateAccount, deleteAccount, reorderAccounts } from '../api';
import { showToast } from '../components/Toast';
import { formatAmount } from '../utils/format';

export default function Settings({ user, onUserUpdate }) {
  const [activeTab, setActiveTab] = useState('profile');

  return (
    <div className="settings-page">
      <div className="settings-sidebar">
        <div className="settings-sidebar-header">
          <span>设置</span>
        </div>
        <nav className="settings-nav">
          <button className={`settings-nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>
            <User size={18} /><span>用户设置</span>
          </button>
          <button className={`settings-nav-item ${activeTab === 'password' ? 'active' : ''}`} onClick={() => setActiveTab('password')}>
            <Key size={18} /><span>修改密码</span>
          </button>
          <button className={`settings-nav-item ${activeTab === 'tags' ? 'active' : ''}`} onClick={() => setActiveTab('tags')}>
            <Tags size={18} /><span>标签修改</span>
          </button>
          <button className={`settings-nav-item ${activeTab === 'balances' ? 'active' : ''}`} onClick={() => setActiveTab('balances')}>
            <WalletCards size={18} /><span>账户余额</span>
          </button>
        </nav>
      </div>
      <div className="settings-content">
        {activeTab === 'profile' && <ProfileSettings user={user} onUserUpdate={onUserUpdate} />}
        {activeTab === 'password' && <PasswordSettings />}
        {activeTab === 'tags' && <TagSettings />}
        {activeTab === 'balances' && <AccountBalanceSettings />}
      </div>
    </div>
  );
}

function ProfileSettings({ user, onUserUpdate }) {
  const [username, setUsername] = useState(user?.username || '');
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (username.trim().length < 2) { showToast('用户名至少2个字符', 'error'); return; }
    setLoading(true);
    try {
      const data = await updateProfile({ username: username.trim(), nickname: nickname.trim() });
      showToast(data.message);
      onUserUpdate?.(data.user);
    } catch (err) { showToast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="settings-panel">
      <h3>用户设置</h3>
      <p className="settings-desc">修改你的用户名和昵称</p>
      <form onSubmit={handleSubmit} className="settings-form">
        <div className="form-group">
          <label>用户名</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="请输入用户名" maxLength={20} />
        </div>
        <div className="form-group">
          <label>昵称</label>
          <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="请输入昵称" maxLength={20} />
        </div>
        <button type="submit" className="btn-primary" disabled={loading}>{loading ? '保存中...' : '保存修改'}</button>
      </form>
    </div>
  );
}

function PasswordSettings() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentPassword) { showToast('请输入当前密码', 'error'); return; }
    if (newPassword.length < 6) { showToast('密码长度不能少于6位', 'error'); return; }
    if (newPassword !== confirmPassword) { showToast('两次输入的密码不一致', 'error'); return; }
    setLoading(true);
    try {
      const data = await changePassword(currentPassword, newPassword);
      showToast(data.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  return (
    <div className="settings-panel">
      <h3>修改密码</h3>
      <p className="settings-desc">修改你的登录密码</p>
      <form onSubmit={handleSubmit} className="settings-form">
        <div className="form-group">
          <label>当前密码</label>
          <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="请输入当前密码" />
        </div>
        <div className="form-group">
          <label>新密码</label>
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少6位" />
        </div>
        <div className="form-group">
          <label>确认新密码</label>
          <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" />
        </div>
        <button type="submit" className="btn-primary" disabled={loading}>{loading ? '修改中...' : '确认修改'}</button>
      </form>
    </div>
  );
}

function TagSettings() {
  const [tagType, setTagType] = useState('expense');

  return (
    <div className="settings-panel">
      <h3>标签修改</h3>
      <p className="settings-desc">管理分类和账户，拖拽调整排序</p>
      <div className="type-tabs">
        <button className={`type-tab ${tagType === 'expense' ? 'active expense' : ''}`} onClick={() => setTagType('expense')}>支出</button>
        <button className={`type-tab ${tagType === 'income' ? 'active income' : ''}`} onClick={() => setTagType('income')}>收入</button>
      </div>
      <TagSection type={tagType} />
    </div>
  );
}

function AccountBalanceSettings() {
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState({});
  const [savingId, setSavingId] = useState(null);

  const typeLabels = { cash: '现金', bank: '银行卡', alipay: '支付宝', wechat: '微信', other: '其他' };

  const loadAccounts = useCallback(() => {
    fetchAccounts()
      .then(d => {
        setAccounts(d.data);
        setBalances(Object.fromEntries(d.data.map(account => [account.id, String(Number(account.balance || 0).toFixed(2))])));
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const handleSave = async (account) => {
    const value = balances[account.id];
    setSavingId(account.id);
    try {
      await updateAccount(account.id, { balance: value });
      showToast('账户余额已保存');
      loadAccounts();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="settings-panel">
      <h3>账户余额</h3>
      <p className="settings-desc">手动设置已有账户余额。这里不会新增账目，也不会计入月报、年报或趋势统计。</p>
      <div className="balance-list">
        {accounts.map(account => (
          <div key={account.id} className="balance-item">
            <div className="balance-info">
              <span className="balance-name">{account.name}</span>
              <span className="balance-meta">{typeLabels[account.type] || account.type} · 当前 {formatAmount(account.balance)}</span>
            </div>
            <input
              type="number"
              step="0.01"
              value={balances[account.id] ?? ''}
              onChange={e => setBalances(prev => ({ ...prev, [account.id]: e.target.value }))}
              placeholder="0.00"
            />
            <button className="btn-primary" onClick={() => handleSave(account)} disabled={savingId === account.id}>
              {savingId === account.id ? '保存中...' : '保存'}
            </button>
          </div>
        ))}
        {accounts.length === 0 && <div className="tag-empty">暂无账户</div>}
      </div>
    </div>
  );
}

function TagSection({ type }) {
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [addingCat, setAddingCat] = useState(false);
  const [addingAcc, setAddingAcc] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState('cash');

  const loadCategories = useCallback(() => {
    fetchCategories(type).then(d => setCategories(d.data)).catch(() => {});
  }, [type]);

  const loadAccounts = useCallback(() => {
    fetchAccounts().then(d => setAccounts(d.data)).catch(() => {});
  }, []);

  useEffect(() => { loadCategories(); loadAccounts(); }, [loadCategories, loadAccounts]);

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    try {
      await createCategory({ name: newCatName.trim(), type });
      setNewCatName('');
      setAddingCat(false);
      loadCategories();
      showToast('分类创建成功');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleDeleteCategory = async (id) => {
    try {
      await deleteCategory(id);
      loadCategories();
      showToast('分类删除成功');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleAddAccount = async () => {
    if (!newAccName.trim()) return;
    try {
      await createAccount({ name: newAccName.trim(), type: newAccType });
      setNewAccName('');
      setAddingAcc(false);
      loadAccounts();
      showToast('账户创建成功');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleDeleteAccount = async (id) => {
    try {
      await deleteAccount(id);
      loadAccounts();
      showToast('账户删除成功');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleReorderCategories = async (fromIndex, toIndex) => {
    const items = [...categories];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    setCategories(items);
    try {
      await reorderCategories(items.map(i => i.id));
    } catch (err) { showToast(err.message, 'error'); loadCategories(); }
  };

  const handleReorderAccounts = async (fromIndex, toIndex) => {
    const items = [...accounts];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    setAccounts(items);
    try {
      await reorderAccounts(items.map(i => i.id));
    } catch (err) { showToast(err.message, 'error'); loadAccounts(); }
  };

  return (
    <div className="tag-sections">
      <div className="tag-section">
        <div className="tag-section-header">
          <h4>分类</h4>
          <button className="btn-icon" onClick={() => setAddingCat(true)} title="添加分类"><Plus size={16} /></button>
        </div>
        {addingCat && (
          <div className="tag-add-row">
            <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="分类名称" maxLength={10} autoFocus onKeyDown={e => e.key === 'Enter' && handleAddCategory()} />
            <button className="btn-icon btn-icon-confirm" onClick={handleAddCategory}><Check size={16} /></button>
            <button className="btn-icon" onClick={() => { setAddingCat(false); setNewCatName(''); }}><X size={16} /></button>
          </div>
        )}
        <DraggableList items={categories} onReorder={handleReorderCategories} onDelete={handleDeleteCategory} />
      </div>

      <div className="tag-section">
        <div className="tag-section-header">
          <h4>账户</h4>
          <button className="btn-icon" onClick={() => setAddingAcc(true)} title="添加账户"><Plus size={16} /></button>
        </div>
        {addingAcc && (
          <div className="tag-add-row">
            <input type="text" value={newAccName} onChange={e => setNewAccName(e.target.value)} placeholder="账户名称" maxLength={10} autoFocus onKeyDown={e => e.key === 'Enter' && handleAddAccount()} />
            <select value={newAccType} onChange={e => setNewAccType(e.target.value)}>
              <option value="cash">现金</option>
              <option value="bank">银行卡</option>
              <option value="alipay">支付宝</option>
              <option value="wechat">微信</option>
              <option value="other">其他</option>
            </select>
            <button className="btn-icon btn-icon-confirm" onClick={handleAddAccount}><Check size={16} /></button>
            <button className="btn-icon" onClick={() => { setAddingAcc(false); setNewAccName(''); }}><X size={16} /></button>
          </div>
        )}
        <DraggableList items={accounts} onReorder={handleReorderAccounts} onDelete={handleDeleteAccount} showType />
      </div>
    </div>
  );
}

function DraggableList({ items, onReorder, onDelete, showType }) {
  const listRef = useRef(null);
  const itemRefs = useRef(new Map());
  const prevPositionsRef = useRef(new Map());
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [offsetY, setOffsetY] = useState(0);
  const startY = useRef(0);
  const itemHeight = useRef(0);
  const dragIndexRef = useRef(null);
  const overIndexRef = useRef(null);
  const isDraggingRef = useRef(false);

  const typeLabels = { cash: '现金', bank: '银行卡', alipay: '支付宝', wechat: '微信', other: '其他' };

  const getEventY = (e) => e.touches ? e.touches[0].clientY : e.clientY;

  /*
  const measurePositions = useCallback(() => {
    const positions = new Map();
    items.forEach((item) => {
      const el = itemRefs.current.get(item.id);
      if (el) {
        positions.set(item.id, el.getBoundingClientRect().top);
      }
    });
    return positions;
  }, [items]);

  useLayoutEffect(() => {
    const prevPositions = prevPositionsRef.current;
    const currentPositions = measurePositions();

    items.forEach((item) => {
      const el = itemRefs.current.get(item.id);
      const prevTop = prevPositions.get(item.id);
      const currentTop = currentPositions.get(item.id);

      if (!el || prevTop == null || currentTop == null) return;

      const deltaY = prevTop - currentTop;
      if (Math.abs(deltaY) < 1) return;

      el.style.transition = 'none';
      el.style.transform = `translateY(${deltaY}px)`;
      void el.offsetHeight;
      el.style.transition = 'transform 180ms ease';
      el.style.transform = '';
    });
  }, [items, measurePositions]);

  useEffect(() => {
    prevPositionsRef.current = measurePositions();
  });
  */

  const handlePointerMove = useCallback((e) => {
    if (e.cancelable) e.preventDefault();
    const dy = getEventY(e) - startY.current;
    if (Math.abs(dy) > 3) isDraggingRef.current = true;
    if (!isDraggingRef.current) return;

    setOffsetY(dy);

    const from = dragIndexRef.current;
    const itemsCount = items.length;
    let target = from;
    if (dy > 0) {
      for (let i = from + 1; i < itemsCount; i++) {
        if (dy > (i - from - 0.5) * itemHeight.current) target = i;
      }
    } else if (dy < 0) {
      for (let i = from - 1; i >= 0; i--) {
        if (dy < (i - from + 0.5) * itemHeight.current) target = i;
      }
    }
    const nextOverIndex = target !== from ? target : null;
    overIndexRef.current = nextOverIndex;
    setOverIndex(nextOverIndex);
  }, [items.length]);

  const handlePointerUp = useCallback(() => {
    document.removeEventListener('mousemove', handlePointerMove);
    document.removeEventListener('mouseup', handlePointerUp);
    document.removeEventListener('touchmove', handlePointerMove);
    document.removeEventListener('touchend', handlePointerUp);

    const from = dragIndexRef.current;
    const to = overIndexRef.current;
    if (from !== null && to !== null && from !== to) {
      onReorder(from, to);
    }

    requestAnimationFrame(() => {
      setDragIndex(null);
      setOverIndex(null);
      setOffsetY(0);
      isDraggingRef.current = false;
      dragIndexRef.current = null;
      overIndexRef.current = null;
    });
  }, [handlePointerMove, onReorder]);

  const handlePointerDown = (e, index) => {
    e.preventDefault();
    const el = listRef.current.children[index];
    itemHeight.current = el.offsetHeight + 4;
    startY.current = getEventY(e);
    dragIndexRef.current = index;
    overIndexRef.current = null;
    isDraggingRef.current = false;
    setDragIndex(index);
    setOverIndex(null);
    setOffsetY(0);
    document.addEventListener('mousemove', handlePointerMove);
    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchmove', handlePointerMove, { passive: false });
    document.addEventListener('touchend', handlePointerUp);
  };

  return (
    <div className="tag-list" ref={listRef}>
      {items.map((item, index) => {
        const isBeingDragged = dragIndex === index;
        const isOver = overIndex === index;
        let shift = 0;
        if (dragIndex !== null && overIndex !== null) {
          if (dragIndex < overIndex && index > dragIndex && index <= overIndex) shift = -1;
          else if (dragIndex > overIndex && index < dragIndex && index >= overIndex) shift = 1;
        }

        const style = isBeingDragged
          ? { transform: `translateY(${offsetY}px)`, zIndex: 10, transition: 'none', boxShadow: 'var(--shadow-lg)', opacity: 0.92 }
          : shift !== 0
            ? { transform: `translateY(${shift * itemHeight.current}px)` }
            : {};

        return (
          <div
            key={item.id}
            ref={(el) => {
              if (el) itemRefs.current.set(item.id, el);
              else itemRefs.current.delete(item.id);
            }}
            className={`tag-item ${isBeingDragged ? 'tag-item-dragging' : ''} ${isOver ? 'tag-item-over' : ''}`}
            style={style}
          >
            <span className="tag-drag-handle" onMouseDown={e => handlePointerDown(e, index)} onTouchStart={e => handlePointerDown(e, index)}>
              <GripVertical size={16} />
            </span>
            <span className="tag-item-name">{item.name}</span>
            {showType && <span className="tag-item-type">{typeLabels[item.type] || item.type}</span>}
            <button className="btn-icon btn-icon-danger" onClick={() => onDelete(item.id)} title="删除"><Trash2 size={14} /></button>
          </div>
        );
      })}
      {items.length === 0 && <div className="tag-empty">暂无数据</div>}
    </div>
  );
}
