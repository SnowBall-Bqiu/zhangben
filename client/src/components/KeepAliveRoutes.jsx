import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Dashboard from '../pages/Dashboard';
import Transactions from '../pages/Transactions';
import Monthly from '../pages/Monthly';
import Yearly from '../pages/Yearly';
import Settings from '../pages/Settings';

const PAGES = [
  { id: '/', match: (path) => path === '/' },
  { id: '/transactions', match: (path) => path === '/transactions' },
  { id: '/monthly', match: (path) => path === '/monthly' },
  { id: '/yearly', match: (path) => path === '/yearly' },
  { id: '/settings', match: (path) => path === '/settings' },
];

function resolvePage(pathname) {
  return PAGES.find((page) => page.match(pathname))?.id ?? null;
}

export default function KeepAliveRoutes({ user, onUserUpdate }) {
  const { pathname } = useLocation();
  const activeId = resolvePage(pathname);
  const [visited, setVisited] = useState(() => new Set(activeId ? [activeId] : ['/']));

  useEffect(() => {
    if (!activeId) return;
    setVisited((prev) => {
      if (prev.has(activeId)) return prev;
      const next = new Set(prev);
      next.add(activeId);
      return next;
    });
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }, [activeId]);

  if (!activeId) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="page-keep-stage">
      {visited.has('/') && (
        <div className={`page-keep ${activeId === '/' ? 'is-active' : 'is-inactive'}`}>
          <Dashboard />
        </div>
      )}
      {visited.has('/transactions') && (
        <div className={`page-keep ${activeId === '/transactions' ? 'is-active' : 'is-inactive'}`}>
          <Transactions />
        </div>
      )}
      {visited.has('/monthly') && (
        <div className={`page-keep ${activeId === '/monthly' ? 'is-active' : 'is-inactive'}`}>
          <Monthly />
        </div>
      )}
      {visited.has('/yearly') && (
        <div className={`page-keep ${activeId === '/yearly' ? 'is-active' : 'is-inactive'}`}>
          <Yearly />
        </div>
      )}
      {visited.has('/settings') && (
        <div className={`page-keep ${activeId === '/settings' ? 'is-active' : 'is-inactive'}`}>
          <Settings user={user} onUserUpdate={onUserUpdate} />
        </div>
      )}
    </div>
  );
}
