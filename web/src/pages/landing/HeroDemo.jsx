import { useEffect, useMemo, useRef, useState } from 'react';
import {
  UploadCloud, Link2, Activity, TimerOff, Video, Check, Copy, Mail, QrCode, RotateCcw, Lock, ShieldCheck,
} from 'lucide-react';
import { useInView, useReducedMotion, clamp01, easeInOut } from './motion';

// A looping, clickable walk through the product: upload -> share -> track -> expire.
// Everything shown mirrors real behaviour (parts four at a time, expiry and
// download-limit choices, 12-character short links, the expired-link page).

const PHASES = [
  { label: 'Upload', icon: UploadCloud, ms: 3800, sr: 'A 1.2 GB video uploads straight to storage in parts, four at a time.' },
  { label: 'Share', icon: Link2, ms: 3800, sr: 'The sender picks a one-hour expiry and a three-download limit, then copies the short link.' },
  { label: 'Track', icon: Activity, ms: 4800, sr: 'The link counts down while two people download the file, one by email and one by QR code.' },
  { label: 'Expire', icon: TimerOff, ms: 3600, sr: 'The link expires. Anyone who opens it sees a page saying so.' },
];
const STILL = [1, 1, 0.62, 1]; // what each step shows when motion is reduced
const LINK = 'd/q7Kx2-fLm9Ta';
const PARTS = 24;
const LIMIT = 3;
const EVENTS = [
  { at: 0.16, icon: Mail, who: 'ana@northwind.studio', how: 'via email' },
  { at: 0.5, icon: QrCode, who: 'A phone', how: 'via QR code' },
];

function usePhaseLoop(running) {
  const [pos, setPos] = useState({ i: 0, p: 0 });
  useEffect(() => {
    if (!running) return undefined;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(now - last, 64);
      last = now;
      setPos(({ i, p }) => {
        const np = p + dt / PHASES[i].ms;
        return np >= 1 ? { i: (i + 1) % PHASES.length, p: 0 } : { i, p: np };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  return [pos, (i) => setPos({ i, p: 0 })];
}

export default function HeroDemo() {
  const ref = useRef(null);
  const visible = useInView(ref, { rootMargin: '0px' });
  const reduced = useReducedMotion();
  const [pos, go] = usePhaseLoop(visible && !reduced);
  const { i } = pos;
  const p = reduced ? STILL[i] : pos.p;

  // The demo link expires an hour after the page was opened, like the default.
  const at = useMemo(() => new Date(Date.now() + 3600e3).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), []);
  const remain = Math.max(0, Math.round(3600 * (1 - clamp01(p / 0.94))));
  const toast = toastFor(i, p, at);

  return (
    <div ref={ref} className="relative isolate mx-auto w-full max-w-[540px]">
      <div aria-hidden="true" className="glow pointer-events-none absolute -inset-20 -z-10 blur-2xl" />

      <div className="panel relative overflow-hidden shadow-lg">
        <div className="grid grid-cols-4 border-b border-line bg-surface-2/70" aria-label="How DropVault works">
          {PHASES.map((ph, k) => {
            const on = k === i;
            const fill = k < i ? 1 : on ? p : 0;
            return (
              <button key={ph.label} type="button" onClick={() => go(k)} aria-current={on ? 'step' : undefined}
                className={`relative flex items-center justify-center gap-1.5 px-1 py-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset sm:text-[13px] ${
                  on ? 'text-fg' : 'text-subtle hover:text-muted'}`}>
                <ph.icon className={`h-3.5 w-3.5 transition-colors ${on ? 'text-accent' : ''}`} />
                {ph.label}
                <span className="absolute inset-x-3 bottom-0 h-[2px] overflow-hidden rounded-full bg-line">
                  <span className="block h-full origin-left bg-accent" style={{ transform: `scaleX(${fill})` }} />
                </span>
              </button>
            );
          })}
        </div>
        <ol className="sr-only">{PHASES.map((ph) => <li key={ph.label}>{ph.label}: {ph.sr}</li>)}</ol>

        <div aria-hidden="true">
          <div className="flex items-center gap-3 px-5 pt-5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-accent">
              <Video className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">product-demo.mp4</div>
              <div className="mt-0.5 font-mono text-[11px] text-subtle">1.2 GB · video/mp4</div>
            </div>
            <StatusBadge i={i} p={p} />
          </div>

          <div key={i} className="h-[252px] animate-step-in px-5 pb-5 pt-4 motion-reduce:animate-none">
            {i === 0 && <UploadStep p={p} />}
            {i === 1 && <ShareStep p={p} at={at} />}
            {i === 2 && <TrackStep p={p} remain={remain} />}
            {i === 3 && <ExpireStep at={at} />}
          </div>
        </div>
      </div>

      {/* Notification that pops in under the card as the story moves along */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-full mt-4 flex justify-center">
        <div key={toast?.key || 'none'}
          className={`panel flex max-w-full items-center gap-2.5 px-3 py-2 shadow-lg transition-opacity duration-300 ${
            toast ? 'animate-step-in opacity-100 motion-reduce:animate-none' : 'opacity-0'}`}>
          {toast && (
            <>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                <toast.icon className="h-3.5 w-3.5" />
              </span>
              <span className="truncate text-xs"><span className="font-medium">{toast.title}</span> <span className="text-muted">{toast.text}</span></span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function toastFor(i, p, at) {
  if (i === 0 && p > 0.86) return { key: 'up', icon: ShieldCheck, title: 'Uploaded.', text: 'Stored encrypted, visible only to you.' };
  if (i === 1 && p > 0.8) return { key: 'copy', icon: Check, title: 'Link copied.', text: `Works until ${at}.` };
  if (i === 2) {
    const e = [...EVENTS].reverse().find((x) => p > x.at);
    if (e) return { key: e.who, icon: e.icon, title: `${e.who} downloaded it`, text: e.how };
  }
  if (i === 3 && p > 0.15) return { key: 'gone', icon: TimerOff, title: 'Link expired on time.', text: 'Nothing left out there.' };
  return null;
}

function StatusBadge({ i, p }) {
  let label; let cls = 'bg-accent-soft text-accent'; let dot = false;
  if (i === 0) { label = p < 0.85 ? 'Uploading' : 'Uploaded'; dot = p < 0.85; }
  else if (i === 1) { label = p > 0.4 ? 'Link ready' : 'Private'; if (p <= 0.4) cls = 'bg-surface-2 text-muted'; }
  else if (i === 2) { label = 'Link active'; dot = true; }
  else { label = 'Expired'; cls = 'bg-surface-2 text-muted'; }
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium ${cls}`}>
      {dot && <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-current motion-reduce:animate-none" />}
      {label}
    </span>
  );
}

const Label = ({ children, className = '' }) => (
  <div className={`font-mono text-[10.5px] uppercase tracking-[0.12em] text-subtle ${className}`}>{children}</div>
);

function UploadStep({ p }) {
  const prog = easeInOut(clamp01(p / 0.85));
  const exact = prog * PARTS;
  const done = Math.min(PARTS, Math.floor(exact + 1e-6));
  const left = Math.max(0, Math.round(29 * (1 - prog)));
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end justify-between">
        <Label>{prog >= 1 ? 'Upload complete' : 'Uploading in parts'}</Label>
        <span className="font-mono text-3xl font-medium leading-none tabular-nums">
          {Math.round(prog * 100)}<span className="text-base text-subtle">%</span>
        </span>
      </div>
      <div className="mt-4 grid grid-cols-12 gap-1.5">
        {Array.from({ length: PARTS }, (_, k) => {
          // Parts run as a pipeline: four in flight at once, each taking four "slots".
          const fill = clamp01((exact - k + 3) / 4);
          return (
            <div key={k} className="relative h-6 overflow-hidden rounded-[4px] border border-line bg-surface-2">
              <div className={`absolute inset-y-0 left-0 ${fill >= 1 ? 'bg-accent' : 'bg-accent/40'}`} style={{ width: `${fill * 100}%` }} />
            </div>
          );
        })}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3.5">
        {[['Sent', `${(1.2 * prog).toFixed(2)} GB`], ['Parts', `${done} / ${PARTS}`], ['Time left', prog >= 1 ? 'done' : `${left} s`]].map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] text-subtle">{k}</dt>
            <dd className="mt-0.5 font-mono text-sm tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto flex items-center gap-2 text-xs text-muted">
        <RotateCcw className="h-3.5 w-3.5 shrink-0 text-accent" />
        Four parts at a time, straight to S3. Pause and resume later.
      </div>
    </div>
  );
}

function ShareStep({ p, at }) {
  const limitSet = p > 0.2;
  const made = p > 0.38;
  const typed = Math.floor(clamp01((p - 0.4) / 0.28) * LINK.length);
  const copied = p > 0.78;
  return (
    <div className="flex h-full flex-col">
      <Label>Link works for</Label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {['15 min', '1 hour', '6 hours', '1 day', '7 days', 'Never'].map((x) => (
          <span key={x} className="chip h-6 px-2 text-[11px]" data-on={x === '1 hour' ? '' : undefined}>{x}</span>
        ))}
      </div>
      <Label className="mt-4">Download limit</Label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {['None', '1', '3', '5', '10', '25'].map((x) => (
          <span key={x} className="chip h-6 min-w-8 px-2 text-[11px]" data-on={(limitSet ? x === '3' : x === 'None') ? '' : undefined}>{x}</span>
        ))}
      </div>

      <div className="mt-auto">
        <div className={`flex items-center gap-2 rounded-md border bg-surface-2 py-1.5 pl-3 pr-1.5 transition-colors ${made ? 'border-line-strong' : 'border-line'}`}>
          <Link2 className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
            {made ? (
              <>
                <span className="text-subtle">…/</span>{LINK.slice(0, typed)}
                {typed < LINK.length && <span className="ml-px inline-block h-3.5 w-[2px] translate-y-0.5 animate-caret bg-accent" />}
              </>
            ) : <span className="text-subtle">Creating a short link…</span>}
          </span>
          <span className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
            copied ? 'bg-accent text-accent-fg' : 'border border-line-strong bg-surface text-fg'}`}>
            {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
          </span>
        </div>
        <div className="mt-2 font-mono text-[11px] text-subtle">Expires at {at} · stops after {LIMIT} downloads</div>
      </div>
    </div>
  );
}

function TrackStep({ p, remain }) {
  const events = EVENTS.filter((e) => p > e.at);
  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(remain % 60).padStart(2, '0');
  return (
    <div className="flex h-full items-start gap-5">
      <div className="flex shrink-0 flex-col items-center">
        <Ring frac={remain / 3600}>
          <span className="font-mono text-xl font-medium tabular-nums">{mm}:{ss}</span>
          <span className="text-[10.5px] text-subtle">left</span>
        </Ring>
        <span className="mt-2 font-mono text-[10.5px] text-subtle">1 hour, sped up</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between">
          <Label>Downloads</Label>
          <span className="font-mono text-sm tabular-nums">{events.length}<span className="text-subtle"> of {LIMIT}</span></span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {Array.from({ length: LIMIT }, (_, k) => (
            <span key={k} className={`h-1.5 rounded-full transition-colors duration-300 ${k < events.length ? 'bg-accent' : 'bg-line'}`} />
          ))}
        </div>
        <ul className="mt-3.5 space-y-2">
          {events.map((e) => (
            <li key={e.who} className="flex animate-step-in items-center gap-2.5 rounded-md border border-line bg-surface-2/60 px-2.5 py-2 motion-reduce:animate-none">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-surface text-muted"><e.icon className="h-3.5 w-3.5" /></span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{e.who}</span>
                <span className="block text-[11px] text-subtle">Downloaded {e.how}</span>
              </span>
            </li>
          ))}
          {events.length < 2 && (
            <li className="rounded-md border border-dashed border-line px-2.5 py-2 text-[11px] text-subtle">Waiting for downloads…</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Ring({ frac, children }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-[108px] w-[108px]">
      <svg viewBox="0 0 108 108" className="h-full w-full -rotate-90">
        <circle cx="54" cy="54" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
        <circle cx="54" cy="54" r={r} fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

function ExpireStep({ at }) {
  return (
    <div className="flex h-full flex-col">
      <div className="overflow-hidden rounded-md border border-line">
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-[11px] text-subtle">
          <Lock className="h-3 w-3 shrink-0" />
          <span className="truncate line-through">…/{LINK}</span>
        </div>
        <div className="flex flex-col items-center px-4 py-4 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-muted"><TimerOff className="h-5 w-5" /></span>
          <div className="mt-2.5 text-sm font-semibold">This link has expired</div>
          <div className="mt-1 text-xs text-muted">It stopped working at {at}. Ask the sender for a new one.</div>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-muted">Expired</span>
        <span className="font-mono text-subtle">2 of {LIMIT} downloads used · the file stays private</span>
      </div>
    </div>
  );
}
