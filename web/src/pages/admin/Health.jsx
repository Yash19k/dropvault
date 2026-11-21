import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, TriangleAlert, XCircle, CircleDashed, Globe, Cpu, Database, HardDrive, Mail, Lock, Eraser,
  BellRing, Activity as ActivityIcon, Timer, Info, ServerCrash,
} from 'lucide-react';
import { adminApi } from '../../api/adminApi';
import { formatCount, formatDateTime, formatRelative } from '../../lib/format';
import { ChartCard } from './charts';
import { useAdminData, PageHeader, RefreshButton, StatTile, Card, Segmented, Dimmed, AdminError, LoadingRows, TH, TD } from './ui';

// A state is always an icon and a word, never color alone.
const STATUS = {
  ok: { icon: CheckCircle2, label: 'OK', text: 'text-accent', soft: 'bg-accent-soft', border: 'border-accent/30' },
  warning: { icon: TriangleAlert, label: 'Needs attention', text: 'text-warning', soft: 'bg-warning-soft', border: 'border-warning/30' },
  error: { icon: XCircle, label: 'Failing', text: 'text-danger', soft: 'bg-danger-soft', border: 'border-danger/30' },
  unknown: { icon: CircleDashed, label: 'Not checked', text: 'text-muted', soft: 'bg-surface-2', border: 'border-line' },
};

const CHECK_ICON = {
  api: Globe, functions: Cpu, files_table: Database, users_table: Database, storage: HardDrive,
  email: Mail, encryption: Lock, cleanup: Eraser, alarms: BellRing,
};

const RANGES = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
];
const RANGE_TEXT = { '1h': 'the last hour', '24h': 'the last 24 hours', '7d': 'the last 7 days' };
const REFRESH_MS = 60 * 1000;

function StatusPill({ status, className = '' }) {
  const s = STATUS[status] || STATUS.unknown;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${s.soft} ${s.text} ${className}`}>
      <s.icon className="h-3 w-3" /> {s.label}
    </span>
  );
}

function banner(data) {
  const attention = data.checks.filter((c) => c.status === 'warning' || c.status === 'error');
  const names = attention.map((c) => c.name).join(', ');
  if (data.status === 'error') return { title: 'Something is failing', text: names };
  if (data.status === 'warning') return { title: `${attention.length} ${attention.length === 1 ? 'check needs' : 'checks need'} attention`, text: names };
  if (data.status === 'ok') return { title: 'All systems operational', text: 'Every check passed.' };
  return { title: 'Health unknown', text: 'None of the checks could run.' };
}

// "10:30", or "Tue 14:00" over a week.
function pointLabel(ms, range) {
  const d = new Date(ms);
  if (range === '7d') return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric' });
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const millis = (v) => (v == null ? '—' : `${Math.round(v).toLocaleString()} ms`);

function DetailValue({ value }) {
  if (typeof value === 'number' && value > 1e12) {
    return <span title={formatDateTime(value)}>{formatRelative(value)}</span>;
  }
  return <>{typeof value === 'number' ? value.toLocaleString() : String(value)}</>;
}

function CheckCard({ check }) {
  const s = STATUS[check.status] || STATUS.unknown;
  const Icon = CHECK_ICON[check.id] || ServerCrash;
  return (
    <section className={`panel flex flex-col px-4 py-3.5 ${check.status === 'error' ? 'border-danger/40' : check.status === 'warning' ? 'border-warning/40' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted">
            <Icon className="h-4 w-4" />
          </div>
          <h2 className="truncate text-sm font-semibold">{check.name}</h2>
        </div>
        <StatusPill status={check.status} />
      </div>
      <p className={`mt-2.5 text-sm ${check.status === 'ok' ? 'text-muted' : s.text}`}>{check.summary}</p>
      {check.details.length > 0 && (
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
          {check.details.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted">{label}</dt>
              <dd className="min-w-0 truncate text-right" title={typeof value === 'string' ? value : undefined}><DetailValue value={value} /></dd>
            </div>
          ))}
        </dl>
      )}
      {check.ms != null && <p className="mt-auto pt-3 text-[11px] text-subtle">Checked in {check.ms} ms</p>}
    </section>
  );
}

function functionStatus(f) {
  if (f.state === 'Failed' || f.state === 'Missing' || f.update === 'Failed') return 'error';
  if (f.errors || f.throttles || f.state === 'Pending') return 'warning';
  if (f.state || f.invocations != null) return 'ok';
  return 'unknown';
}

function ErrorItem({ error }) {
  const [open, setOpen] = useState(false);
  const long = error.message.length > 180;
  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="rounded bg-danger-soft px-1.5 py-0.5 font-mono text-[11px] font-medium text-danger">{error.function}</span>
        <time className="text-subtle" title={formatDateTime(error.at)} dateTime={new Date(error.at).toISOString()}>{formatRelative(error.at)}</time>
      </div>
      <p className={`mt-1.5 break-words font-mono text-xs text-fg ${open ? '' : 'line-clamp-2'}`}>{error.message}</p>
      {long && (
        <button className="mt-1 text-xs text-muted hover:text-fg" onClick={() => setOpen((v) => !v)}>{open ? 'Show less' : 'Show all'}</button>
      )}
    </li>
  );
}

export default function Health() {
  const [range, setRange] = useState('24h');
  const [auto, setAuto] = useState(true);
  const load = useCallback((token) => adminApi.health(range, token), [range]);
  const { data, error, loading, reload } = useAdminData(load);

  // Keep the page live while it's open and visible.
  useEffect(() => {
    if (!auto) return undefined;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [auto, reload]);

  if (error && !data) return <><PageHeader title="Health" /><div className="mt-6"><AdminError error={error} onRetry={reload} /></div></>;

  const b = data && banner(data);
  const s = data && (STATUS[data.status] || STATUS.unknown);
  const api = data?.api;
  const points = (key) => (api?.series || []).map((p) => ({
    key: String(p.t), short: pointLabel(p.t, data.range), label: pointLabel(p.t, data.range), value: p[key] || 0,
  }));
  const serverErrorRate = api?.requests ? (api.errors_5xx / api.requests) * 100 : 0;

  return (
    <div>
      <PageHeader title="Health" subtitle="Live checks of every part of DropVault, and how it has been running.">
        <Segmented label="Time range" value={range} onChange={setRange} options={RANGES} />
        <label className="inline-flex h-9 cursor-pointer select-none items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-xs font-medium text-muted shadow-xs hover:text-fg">
          <input type="checkbox" className="accent-[var(--accent)]" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto-refresh
        </label>
        <RefreshButton onClick={reload} loading={loading} />
      </PageHeader>

      {!data ? <div className="panel mt-6"><LoadingRows rows={5} /></div> : (
        <Dimmed when={loading}>
          <div className={`mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border px-4 py-3 ${s.border} ${s.soft}`} role="status">
            <div className="flex min-w-0 items-center gap-2.5">
              <s.icon className={`h-5 w-5 shrink-0 ${s.text}`} />
              <div className="min-w-0">
                <div className="text-sm font-semibold">{b.title}</div>
                <div className="truncate text-xs text-muted">{b.text}</div>
              </div>
            </div>
            <div className="text-xs text-muted" title={formatDateTime(data.checked_at)}>
              Checked {formatRelative(data.checked_at)}{auto ? ' · refreshes every minute' : ''}
            </div>
          </div>

          {data.offline && (
            <div className="mt-3 flex items-start gap-2.5 rounded-md border border-line bg-surface-2 p-3 text-sm text-muted">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>This is the offline version: the tables, storage, email and encryption are checked against LocalStack.
                API Gateway, Lambda, CloudWatch metrics and logs exist only on AWS.</span>
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.checks.map((c) => <CheckCard key={c.id} check={c} />)}
          </div>

          {api && (
            <>
              <h2 className="mt-8 text-[15px] font-semibold">Traffic in {RANGE_TEXT[data.range]}</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile icon={ActivityIcon} label="API requests" value={formatCount(api.requests)} sub="including link downloads" />
                <StatTile icon={XCircle} label="Server errors (5xx)" value={formatCount(api.errors_5xx)}
                  sub={api.requests ? `${serverErrorRate.toFixed(2)}% of requests` : 'no requests'} />
                <StatTile icon={Info} label="Client errors (4xx)" value={formatCount(api.errors_4xx)} sub="expired links, bad input, throttling" />
                <StatTile icon={Timer} label="Response time" value={millis(api.latency_avg)}
                  sub={`p90 ${millis(api.latency_p90)} · p99 ${millis(api.latency_p99)}`} />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <ChartCard title="Requests" total={formatCount(api.requests)} points={points('requests')} emptyText="No requests in this period" />
                <ChartCard title="Server errors (5xx)" total={formatCount(api.errors_5xx)} points={points('errors_5xx')} emptyText="No server errors" />
                <ChartCard title="Client errors (4xx)" total={formatCount(api.errors_4xx)} points={points('errors_4xx')} emptyText="No client errors" />
                <ChartCard title="Slow responses (p90)" total={millis(api.latency_p90)} points={points('latency_p90')} format={millis}
                  axisFormat={(v) => formatCount(Math.round(v))}
                  emptyText="No requests in this period" note="9 in 10 requests were answered faster than this." />
              </div>
            </>
          )}
          {data.metrics_error && (
            <p className="mt-6 text-sm text-danger">Couldn’t read CloudWatch metrics: {data.metrics_error}</p>
          )}

          {data.functions.length > 0 && !data.offline && (
            <Card title="Lambda functions" className="mt-8 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-surface-2">
                  <tr>
                    <th className={TH}>Function</th>
                    <th className={`${TH} text-right`}>Calls</th>
                    <th className={`${TH} text-right`}>Errors</th>
                    <th className={`${TH} hidden text-right sm:table-cell`}>Throttled</th>
                    <th className={`${TH} hidden text-right md:table-cell`}>Avg / p90 time</th>
                    <th className={`${TH} hidden text-right lg:table-cell`}>Max at once</th>
                    <th className={`${TH} hidden text-right xl:table-cell`}>Memory · timeout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                  {data.functions.map((f) => {
                    const st = STATUS[functionStatus(f)];
                    const rate = f.invocations ? (f.errors / f.invocations) * 100 : 0;
                    return (
                      <tr key={f.name}>
                        <td className={`${TD} w-full max-w-0`}>
                          <div className="flex min-w-0 items-center gap-2" title={f.reason || f.name}>
                            <st.icon className={`h-4 w-4 shrink-0 ${st.text}`} aria-label={st.label} />
                            <span className="truncate font-mono text-xs">{f.short}</span>
                            {f.rejected > 0 && (
                              <span className="hidden truncate text-xs text-muted sm:inline" title="Expired or invalid sign-ins it answered with 401. Not errors.">
                                · {formatCount(f.rejected)} turned away
                              </span>
                            )}
                            {f.state && f.state !== 'Active' && f.state !== 'Inactive' && <StatusPill status={functionStatus(f)} className="hidden sm:inline-flex" />}
                          </div>
                        </td>
                        <td className={`${TD} text-right text-muted`}>{formatCount(f.invocations ?? 0)}</td>
                        <td className={`${TD} whitespace-nowrap text-right ${f.errors ? 'font-medium text-danger' : 'text-muted'}`}>
                          {formatCount(f.errors ?? 0)}{f.errors ? <span className="ml-1 text-xs">({rate.toFixed(1)}%)</span> : null}
                        </td>
                        <td className={`${TD} hidden text-right sm:table-cell ${f.throttles ? 'font-medium text-warning' : 'text-muted'}`}>{formatCount(f.throttles ?? 0)}</td>
                        <td className={`${TD} hidden whitespace-nowrap text-right text-muted md:table-cell`}>{millis(f.duration_avg)} / {millis(f.duration_p90)}</td>
                        <td className={`${TD} hidden text-right text-muted lg:table-cell`}>{f.concurrency != null ? formatCount(f.concurrency) : '—'}</td>
                        <td className={`${TD} hidden whitespace-nowrap text-right text-muted xl:table-cell`}>
                          {f.memory ? `${f.memory} MB · ${f.timeout} s` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}

          {!data.offline && (
            <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Card title={`Recent errors${data.errors ? ` (${data.errors.length})` : ''}`}>
                {data.errors_error && <p className="px-4 py-6 text-sm text-danger">Couldn’t read the logs: {data.errors_error}</p>}
                {data.errors && data.errors.length === 0 && (
                  <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted">
                    <CheckCircle2 className="h-4 w-4 text-accent" /> No errors in {RANGE_TEXT[data.range]}.
                  </p>
                )}
                {data.errors && data.errors.length > 0 && (
                  <ul className="max-h-[480px] divide-y divide-line overflow-y-auto">
                    {data.errors.map((e, i) => <ErrorItem key={`${e.function}-${e.at}-${i}`} error={e} />)}
                  </ul>
                )}
              </Card>

              <Card title={`Alarms${data.alarms ? ` (${data.alarms.length})` : ''}`}>
                {!data.alarms && <p className="px-4 py-6 text-sm text-muted">Couldn’t read the alarms.</p>}
                {data.alarms && data.alarms.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">No alarms set up.</p>}
                {data.alarms && data.alarms.length > 0 && (
                  <ul className="max-h-[480px] divide-y divide-line overflow-y-auto">
                    {data.alarms.map((a) => {
                      const st = a.state === 'ALARM' ? STATUS.error : a.state === 'OK' ? STATUS.ok : STATUS.unknown;
                      const label = a.state === 'ALARM' ? 'Going off' : a.state === 'OK' ? 'OK' : 'No data yet';
                      return (
                        <li key={a.name} className="flex items-start gap-2.5 px-4 py-2.5" title={a.reason || undefined}>
                          <st.icon className={`mt-0.5 h-4 w-4 shrink-0 ${st.text}`} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-xs">{a.name}</div>
                            <div className="line-clamp-2 text-xs text-muted">{a.description}</div>
                          </div>
                          <div className="shrink-0 text-right text-xs">
                            <div className={st.text}>{label}</div>
                            {a.updated_at && <div className="text-subtle" title={formatDateTime(a.updated_at)}>{formatRelative(a.updated_at)}</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>
          )}
        </Dimmed>
      )}
    </div>
  );
}
