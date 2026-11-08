import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Sun, Moon, Home, Receipt, CalendarDays, CalendarRange, Settings, LogOut } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { logout } from '../api';
import { showToast } from './Toast';

export default function Header({ user, onLogout }) {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      onLogout();
      navigate('/');
    } catch {
      showToast('退出登录未完成，请重试', 'error');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <nav className="nav-bar">
      <div className="nav-inner">
        <div className="nav-brand">
          <span className="nav-title">雪球账本</span>
        </div>
        <div className="nav-links">
          <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <Home size={18} />
            <span>首页</span>
          </NavLink>
          <NavLink to="/transactions" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <Receipt size={18} />
            <span>账单</span>
          </NavLink>
          <NavLink to="/monthly" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <CalendarDays size={18} />
            <span>月报</span>
          </NavLink>
          <NavLink to="/yearly" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <CalendarRange size={18} />
            <span>年报</span>
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <Settings size={18} />
            <span>设置</span>
          </NavLink>
        </div>
        <div className="nav-actions">
          <button className="theme-toggle" onClick={toggleTheme} title={theme === 'light' ? '切换深色模式' : '切换浅色模式'}>
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <button className="btn-logout" onClick={handleLogout} disabled={loggingOut} title={loggingOut ? '退出登录中...' : '退出登录'}>
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </nav>
  );
}
