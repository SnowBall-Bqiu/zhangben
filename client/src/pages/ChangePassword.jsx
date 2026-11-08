import { useState } from 'react';
import { changePassword, fetchMe } from '../api';
import { showToast } from '../components/Toast';
import { MAX_PASSWORD_BYTES, PASSWORD_REQUIREMENTS, passwordByteLength, validateNewPassword } from '../utils/password';

export default function ChangePassword({ onDone }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentPassword) {
      showToast('请输入当前密码', 'error');
      return;
    }
    if (passwordByteLength(currentPassword) > MAX_PASSWORD_BYTES) {
      showToast(`当前密码不能超过${MAX_PASSWORD_BYTES}个 UTF-8 字节`, 'error');
      return;
    }
    const passwordError = validateNewPassword(newPassword, currentPassword);
    if (passwordError) {
      showToast(passwordError, 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('两次输入的密码不一致', 'error');
      return;
    }
    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      showToast('密码修改成功');
      const data = await fetchMe();
      onDone(data.user);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card card">
        <h1 className="login-title">首次登录，请修改默认密码</h1>
        <p className="login-subtitle">为了您的数据安全，请立即修改默认密码</p>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>当前密码</label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="请输入当前密码"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>新密码</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder={PASSWORD_REQUIREMENTS}
            />
          </div>
          <div className="form-group">
            <label>确认新密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
            />
          </div>
          <button type="submit" className="btn-primary btn-full" disabled={loading}>
            {loading ? '修改中...' : '确认修改'}
          </button>
        </form>
      </div>
    </div>
  );
}
