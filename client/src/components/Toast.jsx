import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';

let toastId = 0;

const toastListeners = new Set();
let addToastFn = null;

export function showToast(message, type = 'success') {
  if (addToastFn) addToastFn(message, type);
}

export default function Toast() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          {t.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
          {t.message}
        </div>
      ))}
    </div>
  );
}
