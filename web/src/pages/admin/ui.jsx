// Building blocks shared by the admin pages. Everything uses the app's own
// tokens and component classes (panel, btn-*, input), so the admin panel
// looks like the rest of DropVault in light and dark.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Search, ChevronLeft, ChevronRight, AlertTriangle, ShieldAlert, Download,
} from 'lucide-react';
import { Modal, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';

// --- data -----------------------------------------------------------------------
// Load with the current token; reloading keeps the old data on screen (dimmed).
// `load` must be stable (a module-level function or a useCallback).
export function useAdminData(load) {
  const { session } = useAuth();
  const toast = useToast();
  const token = session.tokens.id_token;
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const alive = useRef(true);
  const seq = useRef(0);
  useEffect(() => {
    alive.current = true; // StrictMode mounts twice: set it again on every mount
    return () => { alive.current = false; };
  }, []);

  // Only the newest request counts: switching from "7 days" to "1 hour" (or
  // from one user to another) must not show the slower, older answer.
  const reload = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await load(token);
      if (alive.current && id === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (!alive.current || id !== seq.current) return;
      setState((s) => {
        if (s.data) toast.error(error);   // keep the old data, but say the refresh failed
        return { ...s, error: s.data ? null : error, loading: false };
      });
    }
  }, [load, token, toast]);

  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, token };
}

// Run an admin action: spinner state, toast on success or failure.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const run = useCallback(async (key, fn, success) => {
    setBusy(key);
    try {
      const result = await fn();
      if (success) toast.success(typeof success === 'function' ? success(result) : success);
      return result;
    } catch (err) {
      toast.error(err);
      err.handled = true; // already shown: callers (e.g. ConfirmDialog) don't show it again
      throw err;
    } finally { setBusy(null); }
  }, [toast]);
  return { busy, run };
}

// --- layout ---------------------------------------------------------------------
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function RefreshButton({ onClick, loading }) {
  return (
    <button onClick={onClick} className="btn-secondary w-9 px-0" disabled={loading} title="Refresh" aria-label="Refresh">
      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
    </button>
  );
}

export function ExportButton({ onClick, disabled }) {
  return (
    <button onClick={onClick} className="btn-secondary" disabled={disabled} title="Download as a CSV file">
      <Download className="h-4 w-4" /> Export CSV
    </button>
  );
}

// A card with a small header row.
export function Card({ title, action, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// Keeps the previous render on screen, dimmed, while data reloads.
export function Dimmed({ when, children }) {
  return <div className={`transition-opacity ${when ? 'opacity-60' : ''}`} aria-busy={when || undefined}>{children}</div>;
}

// --- figures --------------------------------------------------------------------
export function StatTile({ label, value, sub, icon: Icon, className = '' }) {
  return (
    <div className={`panel px-4 py-3.5 ${className}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {Icon && <Icon className="h-3.5 w-3.5" />} {label}
      </div>
      <div className="mt-1.5 truncate text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

const TONES = {
  accent: 'bg-accent-soft text-accent',
  muted: 'bg-surface-2 text-muted',
  danger: 'bg-danger-soft text-danger',
  outline: 'border border-line text-muted',
};
export function Badge({ tone = 'muted', children, title }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function AccountBadges({ user }) {
  return (
    <>
      {user.role === 'admin' && (
        <Badge tone="accent" title={user.owner ? 'Owner admin: set in the deployment (admin_emails)' : 'Can open the admin panel'}>
          {user.owner ? 'Owner' : 'Admin'}
        </Badge>
      )}
      {user.suspended && <Badge tone="danger" title="Can't sign in or use the app">Suspended</Badge>}
    </>
  );
}

export function initials(name, email) {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (name ? parts[1]?.[0] || '' : '')).toUpperCase() || '?';
}

export function Avatar({ name, email, size = 'h-8 w-8 text-xs' }) {
  return (
    <div className={`grid shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent ${size}`} aria-hidden="true">
      {initials(name, email)}
    </div>
  );
}

// Name (or email) of a file's owner, linking to their account when it still exists.
export function UserLink({ user, className = '' }) {
  if (!user?.email) return <span className={`text-muted ${className}`}>Deleted account</span>;
  return (
    <Link to={`/admin/users/${encodeURIComponent(user.user_id)}`} className={`hover:text-fg hover:underline underline-offset-2 ${className}`}
      title={user.email} onClick={(e) => e.stopPropagation()}>
      {user.name || user.email}
    </Link>
  );
}

// One row of a meter list: name, figure, and a bar against its own whole.
export function MeterRow({ label, figure, pct, tone = 'accent', title }) {
  const fill = tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-amber-500' : 'bg-accent';
  return (
    <li className="py-2.5" title={title}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 text-xs text-muted tabular-nums">{figure}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.min(100, Math.max(pct > 0 ? 1 : 0, pct))}%` }} />
      </div>
    </li>
  );
}

// Fill color for how full a storage quota is (same thresholds as the file list).
export const quotaTone = (pct) => (pct >= 95 ? 'danger' : pct >= 80 ? 'warning' : 'accent');

// --- controls -------------------------------------------------------------------
export function SearchInput({ value, onChange, placeholder, label }) {
  return (
    <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
      <input className="input h-9 pl-9" placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)} aria-label={label || placeholder} />
    </div>
  );
}

export function FilterSelect({ value, onChange, options, label }) {
  return (
    <select className="input h-9 w-auto pr-8" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

// Light / dark style segmented control (same look as the theme toggle).
export function Segmented({ value, onChange, options, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.value)}
            className={`h-7 rounded-[5px] px-2.5 text-xs font-medium transition-colors ${
              active ? 'bg-surface text-fg shadow-xs' : 'text-muted hover:text-fg'}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toolbar({ children }) {
  return <div className="mt-6 flex flex-wrap items-center gap-2">{children}</div>;
}

// --- tables -----------------------------------------------------------------------
export const PAGE_SIZE = 25;

// Client-side paging; jumps back to page 1 when the list itself changes.
export function usePaged(rows, resetKey) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [resetKey]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const slice = useMemo(() => rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE), [rows, current]);
  return { slice, page: current, pages, setPage, total: rows.length };
}

export function Pagination({ page, pages, total, setPage, noun = 'items' }) {
  if (total <= PAGE_SIZE) return null;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-muted">
      <span className="tabular-nums">{from}–{to} of {total.toLocaleString()} {noun}</span>
      <div className="flex items-center gap-1">
        <button className="btn-icon" onClick={() => setPage(page - 1)} disabled={page === 0} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-1 tabular-nums">{page + 1} / {pages}</span>
        <button className="btn-icon" onClick={() => setPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export const TH = 'whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-muted';
export const TD = 'px-4 py-3 align-middle';

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && (
        <div className="grid h-11 w-11 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <h2 className="mt-4 text-[15px] font-semibold">{title}</h2>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
    </div>
  );
}

export function LoadingRows({ rows = 4 }) {
  return (
    <div className="divide-y divide-line" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="h-8 w-8 animate-pulse rounded-md bg-surface-2" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
            <div className="h-2.5 w-24 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Shown when a page can't load (no admin access, network trouble).
export function AdminError({ error, onRetry }) {
  if (error?.status === 403) {
    return (
      <EmptyState icon={ShieldAlert} title="You don't have admin access">
        Your account is no longer an admin, or was never one. <Link to="/app" className="link">Back to your files</Link>
      </EmptyState>
    );
  }
  return (
    <div className="panel">
      <EmptyState icon={AlertTriangle} title="Couldn't load this page">
        {error?.message || 'Something went wrong.'}
      </EmptyState>
      <div className="-mt-8 flex justify-center pb-10">
        <button className="btn-secondary" onClick={onRetry}><RefreshCw className="h-4 w-4" /> Try again</button>
      </div>
    </div>
  );
}

// --- dialogs ----------------------------------------------------------------------
// A themed confirmation popup (never the browser's confirm()).
export function ConfirmDialog({ title, children, confirmLabel, confirmIcon: ConfirmIcon, danger = false, onConfirm, onClose }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      if (!err?.handled) toast.error(err);
      setBusy(false);
    }
  };
  return (
    <Modal onClose={busy ? () => {} : onClose} width="max-w-md" label={typeof title === 'string' ? title : undefined}
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy} autoFocus>Cancel</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={confirm} disabled={busy}>
          {busy ? <Spinner /> : <>{ConfirmIcon && <ConfirmIcon className="h-4 w-4" />} {confirmLabel}</>}
        </button>
      </>}>
      <div className="flex items-start gap-3.5">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${danger ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'}`}>
          {danger ? <AlertTriangle className="h-4 w-4" /> : ConfirmIcon ? <ConfirmIcon className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <div className="mt-1 text-sm text-muted">{children}</div>
        </div>
      </div>
    </Modal>
  );
}
