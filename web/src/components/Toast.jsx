import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((type, message) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  // Stable identity so consumers using `toast` in effect/callback deps don't loop.
  const toast = useMemo(() => ({
    success: (m) => push('success', m),
    error: (m) => {
      if (m?.silent) return; // handled elsewhere (e.g. expired session -> sign-in page)
      push('error', typeof m === 'string' ? m : m?.message || 'Something went wrong');
    },
  }), [push]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`card flex items-start gap-3 px-4 py-3 text-sm shadow-2xl ${
              t.type === 'error' ? 'border-rose-500/30' : 'border-emerald-500/30'
            }`}
          >
            {t.type === 'error'
              ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
            <span className="max-w-xs">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
