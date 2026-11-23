import { useMemo, useRef, useState } from 'react';
import { Clock, Download, UploadCloud, Mail, QrCode, ShieldCheck, BarChart3, Infinity as InfinityIcon, Check } from 'lucide-react';
import { LINK_EXPIRY, DOWNLOAD_LIMITS } from '../../api/filesApi';
import { CHANNEL, LINK_STATUS } from '../../lib/meta';
import { useFeatures } from '../../lib/features';
import FakeQr from './FakeQr';
import { Reveal, useInView, useInterval, useReducedMotion } from './motion';

// Bento grid of features. Each card carries a small working illustration of
// the real feature rather than a stock icon.

export default function Features() {
  const { email_sharing: emailSharing } = useFeatures();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2" icon={Clock} title="Links that expire on your schedule"
        text="15 minutes, an hour, a week, or never. Pick one when you share, and turn a link off early whenever you like.">
        <ExpiryDemo />
      </Card>
      <Card delay={80} icon={Download} title="Download limits"
        text="Stop a link after 1, 3, 5, 10 or 25 downloads. Email scanners and chat previews can’t use up a one-time link.">
        <LimitDemo />
      </Card>
      {/* With the email card hidden, this one widens so the grid stays full. */}
      <Card className={emailSharing ? undefined : 'lg:col-span-2'} icon={UploadCloud} title="Big files, resumable"
        text="Files go straight from your browser to S3. Anything over 100 MB goes up in parts, and you can resume after closing the tab.">
        <PartsDemo />
      </Card>
      {emailSharing && <Card delay={80} icon={Mail} title="Email a whole team"
        text="Send to several people at once. Everyone gets their own link, so you can tell who downloaded and who didn’t.">
        <EmailDemo />
      </Card>}
      <Card delay={160} icon={QrCode} title="QR codes"
        text="Every link has a short, scannable code. The quickest way to get a file from your laptop to a phone.">
        <QrDemo />
      </Card>
      <Card icon={ShieldCheck} title="Private and encrypted"
        text="Files sit in a private bucket that blocks public access, encrypted at rest with S3 keys, one KMS key, or a key per user.">
        <CipherDemo />
      </Card>
      <Card delay={80} className="lg:col-span-2" icon={BarChart3} title="See every link, and who used it"
        text="Each file lists its links with downloads, last use and status. Turn off one link, or all of them, in a click.">
        <StatsDemo />
      </Card>
    </div>
  );
}

function Card({ icon: Icon, title, text, children, className = '', delay = 0 }) {
  return (
    <Reveal delay={delay}
      className={`panel group flex flex-col overflow-hidden transition-[border-color,box-shadow] duration-300 hover:border-line-strong hover:shadow-lg ${className}`}>
      <div className="relative flex min-h-[176px] flex-1 items-center justify-center border-b border-line bg-surface-2/50 p-5">
        {children}
      </div>
      <div className="p-5">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          <Icon className="h-4 w-4 text-accent" /> {title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
      </div>
    </Reveal>
  );
}

/* ---- Expiry: pick a lifetime, see when a link made now would stop ---------- */

const SHORT = { 900: '15 min', 3600: '1 hour', 21600: '6 hours', 86400: '1 day', 604800: '7 days', never: 'Never' };
const MAX_S = 604800;
const posOf = (s) => (s === 'never' ? 100 : 6 + (Math.log(s / 900) / Math.log(MAX_S / 900)) * 80);

function ExpiryDemo() {
  const [value, setValue] = useState(3600);
  const when = useMemo(() => {
    if (value === 'never') return null;
    return new Date(Date.now() + value * 1000).toLocaleString([], {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }, [value]);
  const pos = posOf(value);
  return (
    <div className="w-full max-w-xl">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Link lifetime">
        {LINK_EXPIRY.map((o) => (
          <button key={o.value} type="button" className="chip" aria-pressed={value === o.value} onClick={() => setValue(o.value)}>
            {SHORT[o.value] || o.label}
          </button>
        ))}
      </div>

      <div className="relative mt-7 h-2 rounded-full bg-line">
        <div className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out ${
          value === 'never' ? 'bg-linear-to-r from-accent via-accent to-transparent' : 'bg-accent'}`}
          style={{ width: `${pos}%` }} />
        {LINK_EXPIRY.filter((o) => o.value !== 'never').map((o) => (
          <span key={o.value} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-line-strong" style={{ left: `${posOf(o.value)}%` }} />
        ))}
        {value !== 'never' && (
          <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-surface bg-accent shadow-sm transition-[left] duration-500 ease-out"
            style={{ left: `${pos}%` }} />
        )}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-subtle">
        <span>Shared now</span>
        <span className="flex items-center gap-1">{value === 'never' ? <><InfinityIcon className="h-3 w-3" /> no end</> : '7 days'}</span>
      </div>

      <p className="mt-4 text-sm" aria-live="polite">
        {when
          ? <>A link made now stops working <span className="font-mono font-medium text-accent">{when}</span>.</>
          : <>A link made now works until <span className="font-medium text-accent">you turn it off</span>.</>}
      </p>
    </div>
  );
}

/* ---- Download limit: slots fill as people download ----------------------- */

function LimitDemo() {
  const limits = DOWNLOAD_LIMITS.filter((o) => o.value);
  const [limit, setLimit] = useState(3);
  const [used, setUsed] = useState(1);
  const ref = useRef(null);
  const inView = useInView(ref);
  const reduced = useReducedMotion();
  // Count up one download at a time, pause on "limit reached", then start over.
  useInterval(() => setUsed((u) => (u >= limit + 2 ? 0 : u + 1)), Math.max(140, 2400 / limit), inView && !reduced);
  const shown = reduced ? Math.ceil(limit / 2) : Math.min(used, limit);
  const full = shown >= limit;
  return (
    <div ref={ref} className="w-full">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Download limit">
        {limits.map((o) => (
          <button key={o.value} type="button" className="chip min-w-9" aria-pressed={limit === o.value}
            onClick={() => { setLimit(o.value); setUsed(0); }}>{o.value}</button>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-[repeat(13,minmax(0,1fr))] gap-1">
        {Array.from({ length: limit }, (_, k) => (
          <span key={k} className={`aspect-square rounded-[3px] transition-colors duration-200 ${k < shown ? 'bg-accent' : 'border border-line-strong'}`} />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="font-mono tabular-nums text-muted">{shown} of {limit} used</span>
        <span className={`rounded px-1.5 py-0.5 font-medium transition-colors ${full ? LINK_STATUS.limit_reached.className : LINK_STATUS.active.className}`}>
          {full ? LINK_STATUS.limit_reached.label : LINK_STATUS.active.label}
        </span>
      </div>
    </div>
  );
}

/* ---- Resumable uploads: groups of four parts light up -------------------- */

function PartsDemo() {
  const ref = useRef(null);
  const inView = useInView(ref);
  const reduced = useReducedMotion();
  const [step, setStep] = useState(2);
  useInterval(() => setStep((s) => (s + 1) % 7), 650, inView && !reduced);
  const doneGroups = reduced ? 2 : Math.min(step, 4);
  return (
    <div ref={ref} className="w-full max-w-[220px]">
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: 16 }, (_, k) => {
          const g = Math.floor(k / 4);
          const state = g < doneGroups ? 'done' : g === doneGroups && doneGroups < 4 ? 'flight' : 'idle';
          return (
            <span key={k} className={`h-7 rounded-[4px] transition-colors duration-300 ${
              state === 'done' ? 'bg-accent' : state === 'flight' ? 'animate-pulse-soft bg-accent/35 motion-reduce:animate-none' : 'border border-line bg-surface'}`} />
          );
        })}
      </div>
      <div className="mt-3 flex justify-between font-mono text-[11px] text-subtle">
        <span>{doneGroups * 4}/16 parts</span>
        <span>{doneGroups >= 4 ? 'complete' : '4 at a time'}</span>
      </div>
    </div>
  );
}

/* ---- Email: each recipient gets their own link ---------------------------- */

const RECIPIENTS = [
  { email: 'ana@northwind.studio', code: 'q7Kx2-fLm9Ta', got: true },
  { email: 'raj@northwind.studio', code: 'Zp41sV0bQe_r', got: true },
  { email: 'li@northwind.studio', code: 'Hm8uC3nWkd2L', got: false },
];

function EmailDemo() {
  return (
    <ul className="w-full space-y-1.5">
      {RECIPIENTS.map((r) => (
        <li key={r.email} className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-2.5 py-2 shadow-xs">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold uppercase text-accent">{r.email[0]}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{r.email}</span>
            <span className="block truncate font-mono text-[10.5px] text-subtle">…/d/{r.code}</span>
          </span>
          {r.got
            ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="Downloaded" />
            : <span className="shrink-0 text-[10.5px] text-subtle">not yet</span>}
        </li>
      ))}
    </ul>
  );
}

/* ---- QR: a code with a scan line sweeping over it ------------------------- */

function QrDemo() {
  return (
    <div className="relative w-[132px]">
      <div className="relative overflow-hidden rounded-lg border border-line bg-white p-2.5 shadow-sm">
        <FakeQr />
        <span className="absolute inset-x-1.5 h-[2px] animate-scan rounded-full bg-accent shadow-[0_0_12px_2px_var(--glow)] motion-reduce:hidden" />
      </div>
      {['left-0 top-0 border-l-2 border-t-2 rounded-tl-md', 'right-0 top-0 border-r-2 border-t-2 rounded-tr-md',
        'left-0 bottom-0 border-l-2 border-b-2 rounded-bl-md', 'right-0 bottom-0 border-r-2 border-b-2 rounded-br-md'].map((c) => (
        <span key={c} className={`absolute -m-2 h-5 w-5 border-accent ${c}`} />
      ))}
    </div>
  );
}

/* ---- Encryption: what a stored file looks like to anyone else ------------- */

const HEX = '0123456789abcdef';
function CipherDemo() {
  const ref = useRef(null);
  const inView = useInView(ref);
  const reduced = useReducedMotion();
  const [seed, setSeed] = useState(1);
  useInterval(() => setSeed((s) => s + 1), 140, inView && !reduced);
  const lines = useMemo(() => Array.from({ length: 4 }, (_, l) => Array.from({ length: 4 }, (_, w) =>
    Array.from({ length: 4 }, (_, c) => HEX[(Math.imul(seed * 31 + l * 7 + w * 13 + c, 2654435761) >>> 27) % 16]).join('')).join(' ')), [seed]);
  return (
    <div ref={ref} className="w-full max-w-[250px]">
      <div className="rounded-md border border-line bg-surface p-3 font-mono text-[11.5px] leading-5 text-subtle shadow-xs">
        {lines.map((l, k) => <div key={k} className={k === 1 ? 'text-accent' : ''}>{l}</div>)}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1 text-center text-[10.5px] font-medium">
        {['SSE-S3', 'KMS key', 'Key per user'].map((x, k) => (
          <span key={x} className={`rounded px-1 py-1 ${k === 0 ? 'bg-accent-soft text-accent' : 'bg-surface text-muted ring-1 ring-line'}`}>{x}</span>
        ))}
      </div>
    </div>
  );
}

/* ---- Stats: the links list from a file's "Links" dialog ------------------- */

const LINKS = [
  { channel: 'qr', who: 'QR code', status: 'active', meta: '3 downloads · expires in 6 h' },
  { channel: 'email', who: 'ana@northwind.studio', status: 'limit_reached', meta: '1 of 1 downloads · last 2 h ago' },
  { channel: 'link', who: 'Copied link', status: 'expired', meta: '12 downloads · last yesterday' },
  { channel: 'email', who: 'raj@northwind.studio', status: 'revoked', meta: '0 downloads · turned off by you' },
];

function StatsDemo() {
  return (
    <div className="w-full max-w-xl">
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="truncate text-sm font-medium">product-demo.mp4</span>
        <span className="shrink-0 font-mono text-[11px] text-subtle">16 downloads · 1 active link</span>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface shadow-xs">
        {LINKS.map((l) => {
          const ch = CHANNEL[l.channel];
          const st = LINK_STATUS[l.status];
          return (
            <li key={l.who} className="flex items-center gap-3 px-3 py-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted"><ch.icon className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium">{l.who}</span>
                  <span className={`shrink-0 rounded px-1.5 py-px text-[10.5px] font-medium ${st.className}`}>{st.label}</span>
                </span>
                <span className="block truncate text-[11px] text-subtle">{l.meta}</span>
              </span>
              {l.status === 'active' && (
                <span className="hidden h-7 shrink-0 items-center rounded-md border border-line-strong bg-surface px-2.5 text-[11px] font-medium sm:inline-flex">Turn off</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
