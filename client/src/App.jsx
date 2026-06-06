import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { fetchMe } from './api';
import Header from './components/Header';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Monthly from './pages/Monthly';
import Settings from './pages/Settings';
import Toast from './components/Toast';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMe()
      .then(data => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-dots">
          <span></span><span></span><span></span>
        </div>
        <p>加载中...</p>
      </div>
    );
  }

  if (!user) {
    return <><Login onLogin={setUser} /><Toast /></>;
  }

  if (user.mustChangePassword) {
    return <><ChangePassword onDone={setUser} /><Toast /></>;
  }

  return (
    <div className="app-layout">
      <Header user={user} onLogout={() => setUser(null)} />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/monthly" element={<Monthly />} />
          <Route path="/settings" element={<Settings user={user} onUserUpdate={setUser} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Toast />
    </div>
  );
}
