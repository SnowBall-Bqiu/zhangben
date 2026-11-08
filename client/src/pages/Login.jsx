import { useState } from 'react';
import { login } from '../api';
import { showToast } from '../components/Toast';
import { MAX_PASSWORD_BYTES, passwordByteLength } from '../utils/password';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      showToast('请输入用户名和密码', 'error');
      return;
    }
    if (passwordByteLength(password) > MAX_PASSWORD_BYTES) {
      showToast(`密码不能超过${MAX_PASSWORD_BYTES}个 UTF-8 字节`, 'error');
      return;
    }
    setLoading(true);
    try {
      const data = await login(username.trim(), password);
      showToast(data.message);
      onLogin(data.user);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card card">
        <h1 className="login-title">欢迎来到雪球账本</h1>
        <p className="login-subtitle">记录每一笔，积少成多</p>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>用户名</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="请输入用户名"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="请输入密码"
            />
          </div>
          <button type="submit" className="btn-primary btn-full" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
