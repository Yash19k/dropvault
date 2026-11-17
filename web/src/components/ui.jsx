import { useEffect, useState } from 'react';
import { Loader2, Eye, EyeOff, X } from 'lucide-react';
import { APP_NAME } from '../brand';

// Mark: an arrow dropping into a tray. Uses theme tokens so it adapts to light/dark.
export function LogoMark({ className = 'h-7 w-7' }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <g fill="none" stroke="var(--accent-fg)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 7.5v10.5m0 0-4.2-4.2M16 18l4.2-4.2" />
        <path d="M8.5 18.5v3a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3" />
      </g>
    </svg>
  );
}

export function Logo({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-fg">{APP_NAME}</span>
    </span>
  );
}

export const Spinner = ({ className = '' }) => <Loader2 className={`h-4 w-4 animate-spin ${className}`} />;

export function Field({ label, hint, ...props }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <input className="input" {...props} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function PasswordField({ label, hint, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <div className="relative">
        <input type={show ? 'text' : 'password'} className="input pr-10" {...props} />
        <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-subtle hover:text-fg">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

// Popup shell: dimmed backdrop, click-outside and Escape to close.
export function Modal({ onClose, title, icon: Icon, children, footer, width = 'max-w-md' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 dark:bg-black/60" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className={`panel w-full shadow-lg ${width}`} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
              {Icon && <Icon className="h-4 w-4 shrink-0 text-muted" />}
              <span className="truncate">{title}</span>
            </h2>
            <button type="button" onClick={onClose} className="btn-icon -mr-1.5" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="px-5 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 rounded-b-lg border-t border-line bg-surface-2 px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}
