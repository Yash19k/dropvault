import { useEffect, useId, useRef, useState } from 'react';
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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Popup shell: dimmed backdrop, click-outside and Escape to close. Focus moves
// into the dialog (unless a field has autoFocus), Tab stays inside it, and
// focus goes back to where it was when it closes. Tall dialogs scroll on
// small screens instead of being cut off.
export function Modal({ onClose, title, label, icon: Icon, children, footer, width = 'max-w-md' }) {
  const ref = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) { e.preventDefault(); ref.current.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === ref.current || !ref.current.contains(at))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (at === last || !ref.current.contains(at))) {
        e.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const previous = document.activeElement;
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 dark:bg-black/60">
      <div className="flex min-h-full items-center justify-center p-4" onClick={onClose}>
        <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : label}
          className={`panel w-full shadow-lg outline-none ${width}`} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 id={titleId} className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
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
    </div>
  );
}
