import { useState, useEffect } from 'react';
import { fetchMe } from './api';
import Header from './components/Header';
import KeepAliveRoutes from './components/KeepAliveRoutes';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Toast from './components/Toast';

function VersionFooter() {
  return (
    <footer className="app-footer" aria-label="应用版本">
      <span>VERSION</span>
      <span className="app-footer-version">{__APP_VERSION__}</span>
    </footer>
  );
}

function AppFrame({ children }) {
  return (
    <div className="app-layout">
      {children}
      <VersionFooter />
      <Toast />
    </div>
  );
}

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
      <AppFrame>
        <div className="loading-screen">
          <div className="loading-dots">
            <span></span><span></span><span></span>
          </div>
          <p>加载中...</p>
        </div>
      </AppFrame>
    );
  }

  if (!user) {
    return <AppFrame><Login onLogin={setUser} /></AppFrame>;
  }

  if (user.mustChangePassword) {
    return <AppFrame><ChangePassword onDone={setUser} /></AppFrame>;
  }

  return (
    <AppFrame>
      <Header user={user} onLogout={() => setUser(null)} />
      <main className="main-content">
        <KeepAliveRoutes user={user} onUserUpdate={setUser} />
      </main>
    </AppFrame>
  );
}
