// Pieces of the admin Analytics page: the live "right now" panel, stat tiles
// with a change against the period before, ranked lists and wording.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, ArrowDownRight, Minus, Monitor, Smartphone, Tablet, User, BarChart3, Table2,
} from 'lucide-react';
import { adminApi } from '../../api/adminApi';
import { useAuth } from '../../context/AuthContext';
import { formatCount, formatRelative } from '../../lib/format';
import { ColumnChart } from './charts';
import { Sparkline, TrendChart, useTick } from './analyticsCharts';
import { Avatar, MeterRow } from './ui';

// --- wording -----------------------------------------------------------------------
export function formatDuration(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(s / 3600);
  return `${h}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

// "12 min", "2 h 5 min" for how long someone has been here.
export function formatSince(ms) {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return 'just arrived';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export const formatPct = (v) => `${(Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

const PAGE_NAMES = {
  '/': 'Home', '/app': 'Files', '/login': 'Sign in', '/signup': 'Sign up', '/how-it-works': 'How it works',
  '/deploy': 'Deploy guide', '/admin': 'Admin overview', '/admin/analytics': 'Admin analytics',
  '/admin/users': 'Admin users', '/admin/users/:id': 'Admin user details', '/admin/files': 'Admin files',
  '/admin/links': 'Admin links', '/admin/activity': 'Admin activity', '/admin/health': 'Admin health',
  '/admin/system': 'Admin system',
};
export const pageName = (path) => PAGE_NAMES[path] || path;

export const SOURCE_NAMES = { direct: 'Direct or bookmark' };

// "Asia/Kolkata" -> "Kolkata (Asia)"
export function zoneName(tz) {
  if (!tz) return 'Unknown';
  const parts = tz.split('/');
  const city = parts[parts.length - 1].replace(/_/g, ' ');
  return parts.length > 1 ? `${city} (${parts[0]})` : city;
}

export const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };
export const DEVICE_NAME = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };

// --- change against the previous period ---------------------------------------------
export function Delta({ cur, prev, lowerIsBetter = false }) {
  if (!prev && !cur) return <span className="text-subtle">No data before</span>;
  if (!prev) return <span className="text-muted">New this period</span>;
  const change = ((cur - prev) / prev) * 100;
  if (Math.abs(change) < 0.5) {
    return <span className="inline-flex items-center gap-0.5 text-muted"><Minus className="h-3 w-3" /> No change</span>;
  }
  const up = change > 0;
  const good = lowerIsBetter ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const text = Math.abs(change) >= 1000 ? `${formatCount(Math.round(Math.abs(change) / 100))}×` : `${Math.round(Math.abs(change))}%`;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${good ? 'text-viz-good' : 'text-danger'}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">{up ? 'Up' : 'Down'}</span> {text}
    </span>
  );
}

// A stat tile that can be picked to show its trend below.
export function KpiTile({ label, icon: Icon, value, cur, prev, lowerIsBetter, spark, active, onClick, period }) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {Icon && <Icon className="h-3.5 w-3.5" />} {label}
      </div>
      <div className="mt-1.5 truncate text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate"><Delta cur={cur} prev={prev} lowerIsBetter={lowerIsBetter} /></span>
      </div>
      {spark && <Sparkline values={spark} className="mt-2" />}
      <span className="sr-only">compared with the {period} before</span>
    </>
  );
  if (!onClick) return <div className="panel px-4 py-3.5">{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`panel px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring ${
        active ? 'border-accent bg-surface' : 'hover:bg-surface-2'}`}>
      {body}
    </button>
  );
}

// A chart in a card with its total and a switch to a table of the same numbers.
export function TrendCard({ title, total, note, points, format = formatCount, axisFormat, kind = 'line', emptyText, action }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="panel px-4 pb-3 pt-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {total !== undefined && <div className="mt-0.5 text-2xl font-semibold tracking-tight">{total}</div>}
        </div>
        <div className="flex items-center gap-1">
          {action}
          <button className="btn-icon" onClick={() => setAsTable((v) => !v)}
            title={asTable ? 'Show as chart' : 'Show as table'} aria-label={asTable ? `Show ${title} as a chart` : `Show ${title} as a table`}>
            {asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="mt-3">
        {asTable ? (
          <div className="overflow-y-auto rounded-md border border-line" style={{ height: kind === 'line' ? 200 : 150 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-2 text-muted">
                <tr><th className="px-3 py-1.5 text-left font-medium">Period</th><th className="px-3 py-1.5 text-right font-medium">{title}</th></tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {[...points].reverse().map((p) => (
                  <tr key={p.key}><td className="px-3 py-1.5 text-muted">{p.label}</td><td className="px-3 py-1.5 text-right">{format(p.value)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : kind === 'line' ? (
          <TrendChart points={points} title={title} format={format} axisFormat={axisFormat} emptyText={emptyText} />
        ) : (
          <ColumnChart points={points} title={title} format={format} axisFormat={axisFormat} emptyText={emptyText} />
        )}
      </div>
      {note && <p className="mt-2 text-[11px] text-subtle">{note}</p>}
    </section>
  );
}

// A ranked list of names with a bar against the biggest.
export function RankList({ rows, valueKey, format = formatCount, name = (r) => r.name, figure, empty = 'No data yet' }) {
  if (!rows.length) return <p className="px-4 py-8 text-center text-sm text-muted">{empty}</p>;
  const top = Math.max(1, ...rows.map((r) => r[valueKey]));
  return (
    <ul className="px-4 py-1.5">
      {rows.map((r) => (
        <MeterRow key={r.name} label={name(r)} figure={figure ? figure(r) : format(r[valueKey])} pct={(r[valueKey] / top) * 100} />
      ))}
    </ul>
  );
}

// --- right now -----------------------------------------------------------------------
const LIVE_EVERY = 15_000;

// Polls /analytics/live while the page is visible.
export function useLive() {
  const { session } = useAuth();
  const token = session.tokens.id_token;
  const [state, setState] = useState({ data: null, error: null });
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const data = await adminApi.live(token);
      if (alive.current) setState({ data, error: null });
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, error }));
    }
  }, [token]);
  useEffect(() => {
    alive.current = true;
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, LIVE_EVERY);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);
  return { ...state, reload: load };
}

export function OnlineDot({ className = '' }) {
  return <span className={`block h-2.5 w-2.5 rounded-full bg-viz-good ring-2 ring-surface ${className}`} aria-hidden="true" />;
}

function Person({ row }) {
  const DeviceIcon = DEVICE_ICON[row.device] || Monitor;
  const name = row.user ? (row.user.name || row.user.email || 'Deleted account') : 'Visitor';
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="relative shrink-0">
        {row.user ? <Avatar name={row.user.name} email={row.user.email} /> : (
          <div className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden="true"><User className="h-4 w-4" /></div>
        )}
        <OnlineDot className="absolute -bottom-0.5 -right-0.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          {row.user?.email ? (
            <Link to={`/admin/users/${encodeURIComponent(row.user.user_id)}`} className="truncate font-medium hover:underline underline-offset-2"
              title={row.user.email}>{name}</Link>
          ) : <span className="truncate font-medium">{name}</span>}
          {row.tabs > 1 && <span className="shrink-0 text-xs text-subtle">{row.tabs} tabs</span>}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <span className="truncate">on {pageName(row.page)}</span>
          {row.zone && <span className="hidden truncate sm:inline">· {zoneName(row.zone)}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-muted">
        <div className="flex items-center justify-end gap-1" title={`${DEVICE_NAME[row.device] || 'Desktop'} · ${row.browser || ''} on ${row.os || ''}`}>
          <DeviceIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{row.browser}</span>
        </div>
        <div className="tabular-nums">{formatSince(row.since)}</div>
      </div>
    </li>
  );
}

export function LivePanel({ live }) {
  useTick(10_000);
  const { data, error } = live;
  if (!data) {
    return (
      <section className="panel px-4 py-10 text-center text-sm text-muted">
        {error ? `Couldn't load who is online: ${error.message}` : 'Checking who is online…'}
      </section>
    );
  }
  const points = data.last_hour.map((s) => {
    const t = new Date(s.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return { key: s.start, short: t, label: `${t} (5 minutes)`, value: s.visitors };
  });
  const c = data.counts;
  return (
    <section className="panel overflow-hidden" aria-labelledby="live-title">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 id="live-title" className="flex items-center gap-2 text-sm font-semibold">
          <OnlineDot /> Right now
        </h2>
        <span className="text-xs text-subtle">
          Updates every 15 seconds · {formatRelative(data.generated_at) === 'just now' ? 'updated just now' : `updated ${formatRelative(data.generated_at)}`}
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="text-5xl font-semibold tracking-tight" aria-live="polite">{formatCount(c.online)}</div>
              <div className="mt-1 text-sm text-muted">{c.online === 1 ? 'person' : 'people'} online now</div>
            </div>
            <dl className="grid grid-cols-3 gap-x-5 pb-1 text-sm">
              <div><dt className="text-xs text-muted">Signed in</dt><dd className="font-semibold tabular-nums">{formatCount(c.signed_in)}</dd></div>
              <div><dt className="text-xs text-muted">Visitors</dt><dd className="font-semibold tabular-nums">{formatCount(c.guests)}</dd></div>
              <div><dt className="text-xs text-muted">Today</dt><dd className="font-semibold tabular-nums">{formatCount(data.today.visitors)}</dd></div>
            </dl>
          </div>
          <div className="mt-5">
            <div className="mb-2 flex items-baseline justify-between text-xs">
              <span className="font-medium">Visitors in the last hour</span>
              <span className="text-subtle">per 5 minutes</span>
            </div>
            <ColumnChart points={points} title="Visitors in the last hour" emptyText="Nobody in the last hour" />
          </div>
          {data.pages_now.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-medium">Pages open now</div>
              <ul className="mt-1">
                {data.pages_now.slice(0, 4).map((p) => (
                  <MeterRow key={p.name} label={pageName(p.name)} figure={`${p.tabs} ${p.tabs === 1 ? 'tab' : 'tabs'}`}
                    pct={(p.tabs / Math.max(1, data.pages_now[0].tabs)) * 100} />
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-between px-4 pb-1 pt-3 text-xs text-muted">
            <span className="font-medium text-fg">Who is online</span>
            <span>Page · device · here for</span>
          </div>
          {data.online.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted">
              Nobody is on DropVault right now. People show up here within 30 seconds of opening any page.
            </p>
          ) : (
            <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">
              {data.online.map((row) => <Person key={row.sid} row={row} />)}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
