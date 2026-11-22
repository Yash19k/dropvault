import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight, Check, ChevronDown, Copy, Info, Lightbulb, SquareTerminal, TriangleAlert,
} from 'lucide-react';
import { REPO_URL } from '../../brand';

// Building blocks of the deploy guide (/deploy): code blocks with a copy
// button, callouts, file links, expandable troubleshooting items, and the
// per-step "Done" progress kept in localStorage.

const repoLink = (p) => `${REPO_URL}/${/\.[a-z]+$/i.test(p) || /Makefile$/.test(p) ? 'blob' : 'tree'}/main/${p}`;

export const kicker = 'font-mono text-[11px] uppercase tracking-[0.12em] text-subtle';

/* ---- Progress ------------------------------------------------------------ */

const PROGRESS_KEY = 'dropvault.deploy-guide.done';

function readDone() {
  try {
    const v = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

// Which steps are ticked "Done". Saved per browser; works without storage too.
export function useProgress() {
  const [done, setDone] = useState(readDone);
  useEffect(() => {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(done)); } catch { /* storage unavailable */ }
  }, [done]);
  const toggle = useCallback((id) => {
    setDone((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  }, []);
  const reset = useCallback(() => setDone([]), []);
  return { done, toggle, reset };
}

/* ---- Text helpers -------------------------------------------------------- */

// Inline code: a command, a variable or a file name in running text.
export function C({ children }) {
  return (
    <code className="rounded-[4px] border border-line bg-surface-2 px-1 py-px font-mono text-[0.84em] text-fg [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

// A link to a file or folder in the repository.
export function FileLink({ path, children }) {
  return (
    <a href={repoLink(path)} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent">
      {children || path} <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}

export function Files({ paths, className = '' }) {
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`}>
      {paths.map((p) => <li key={p}><FileLink path={p} /></li>)}
    </ul>
  );
}

export function Bullets({ items, className = '' }) {
  return (
    <ul className={`space-y-2 ${className}`}>
      {items.map((p, k) => (
        <li key={k} className="relative pl-4 text-[15px] leading-relaxed text-muted">
          <span aria-hidden="true" className="absolute left-0.5 top-[0.62em] h-1.5 w-1.5 rounded-[2px] bg-accent" />
          {p}
        </li>
      ))}
    </ul>
  );
}

export function P({ children, className = '' }) {
  return <p className={`text-[15px] leading-relaxed text-muted ${className}`}>{children}</p>;
}

/* ---- Code block ---------------------------------------------------------- */

const SHELLS = {
  powershell: 'PowerShell',
  bash: 'Git Bash',
  file: 'File',
  output: 'Output',
};

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / insecure origins: fall back to a hidden textarea.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

// A command or file to copy. `shell` says where it runs; `where` says which folder.
export function Code({ shell = 'bash', where, title, children }) {
  const text = String(children).replace(/^\n+|\s+$/g, '');
  const [state, setState] = useState('idle');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = async () => {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1800);
  };

  const label = title || SHELLS[shell] || shell;
  const isOutput = shell === 'output';
  return (
    <div className="my-4 overflow-hidden rounded-lg border border-line bg-surface-2">
      <div className="flex items-center justify-between gap-3 border-b border-line py-1.5 pl-3 pr-1.5">
        <span className="flex min-w-0 items-center gap-2 font-mono text-[11.5px] text-muted">
          <SquareTerminal className="h-3.5 w-3.5 shrink-0 text-subtle" />
          <span className="font-medium text-fg">{label}</span>
          {where && <span className="truncate text-subtle">in {where}</span>}
        </span>
        {!isOutput && (
          <button type="button" onClick={onCopy}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-line hover:text-fg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
            aria-label={`Copy ${label} ${shell === 'file' ? 'text' : 'command'}`}>
            {state === 'copied'
              ? <><Check className="h-3.5 w-3.5 text-accent" /> Copied</>
              : state === 'failed'
                ? <>Press Ctrl+C</>
                : <><Copy className="h-3.5 w-3.5" /> Copy</>}
          </button>
        )}
      </div>
      <pre className={`overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-[1.65] ${isOutput ? 'text-muted' : 'text-fg'}`}>
        <code>{text}</code>
      </pre>
      <span className="sr-only" aria-live="polite">{state === 'copied' ? 'Copied to the clipboard' : ''}</span>
    </div>
  );
}

/* ---- Callouts ------------------------------------------------------------ */

const CALLOUTS = {
  learn: { icon: Lightbulb, label: 'What you’re learning', box: 'border-accent/40 bg-accent-soft', iconCls: 'text-accent' },
  warn: { icon: TriangleAlert, label: 'Careful', box: 'border-warning/40 bg-warning-soft', iconCls: 'text-warning' },
  note: { icon: Info, label: 'Note', box: 'border-line bg-surface-2', iconCls: 'text-muted' },
};

export function Callout({ kind = 'note', title, children, className = '' }) {
  const c = CALLOUTS[kind];
  return (
    <aside className={`my-4 flex gap-3 rounded-lg border px-4 py-3.5 ${c.box} ${className}`}>
      <c.icon className={`mt-0.5 h-4 w-4 shrink-0 ${c.iconCls}`} aria-hidden="true" />
      <div className="min-w-0 text-[14.5px] leading-relaxed text-muted">
        <p className="font-semibold text-fg">{title || c.label}</p>
        <div className="mt-1 space-y-2">{children}</div>
      </div>
    </aside>
  );
}

export const Learn = (props) => <Callout kind="learn" {...props} />;
export const Warn = (props) => <Callout kind="warn" {...props} />;
export const Note = (props) => <Callout kind="note" {...props} />;

/* ---- Troubleshooting item ------------------------------------------------ */

export function Trouble({ title, children }) {
  return (
    <details className="group border-b border-line last:border-b-0">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3.5 text-[15px] font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{title}</span>
        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-subtle transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 px-4 pb-4 text-[14.5px] leading-relaxed text-muted [&_pre]:text-[12px]">
        {children}
      </div>
    </details>
  );
}
