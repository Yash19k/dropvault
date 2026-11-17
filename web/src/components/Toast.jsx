import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback((type, message) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, type, message }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

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
      <div aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} role="status"
            className="panel pointer-events-auto flex w-full max-w-sm items-start gap-2.5 px-3.5 py-3 text-sm shadow-lg">
            {t.type === 'error'
              ? <AlertCircle className="mt-px h-4 w-4 shrink-0 text-danger" />
              : <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-accent" />}
            <span className="min-w-0 flex-1 text-fg">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="-m-1 rounded p-1 text-subtle hover:text-fg" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
