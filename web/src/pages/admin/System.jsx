import { Activity as ActivityIcon, AlertTriangle, CheckCircle2, CircleDashed, Info, Server, Timer, TriangleAlert } from 'lucide-react';
import { adminApi } from '../../api/adminApi';
import { formatBytes, formatCount, formatDateTime, formatRelative } from '../../lib/format';
import { ColumnChart } from './charts';
import { useAdminData, PageHeader, RefreshButton, StatTile, Card, Dimmed, AdminError, LoadingRows, TH, TD } from './ui';

// Alarm states: an icon and a word, never color alone.
const ALARM = {
  OK: { icon: CheckCircle2, label: 'OK', className: 'text-accent' },
  ALARM: { icon: AlertTriangle, label: 'Alarm', className: 'text-danger' },
  INSUFFICIENT_DATA: { icon: CircleDashed, label: 'No data yet', className: 'text-muted' },
};

const ENCRYPTION = {
  s3: 'SSE-S3 (Amazon S3 managed keys)',
  shared: 'One KMS key for the app',
  per_user: 'One KMS key per user',
};

function hourLabel(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function System() {
  const { data, error, loading, reload } = useAdminData(adminApi.system);

  if (error && !data) return <><PageHeader title="System" /><div className="mt-6"><AdminError error={error} onRetry={reload} /></div></>;

  return (
    <div>
      <PageHeader title="System" subtitle="Health over the last 24 hours, and how this deployment is set up.">
        <RefreshButton onClick={reload} loading={loading} />
      </PageHeader>
      {!data ? <div className="panel mt-6"><LoadingRows /></div> : (
        <Dimmed when={loading}>
          <Health health={data.health} />
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Config config={data.config} />
            <Counts counts={data.counts} />
          </div>
        </Dimmed>
      )}
    </div>
  );
}

function Health({ health }) {
  if (!health.available) {
    return (
      <div className="mt-6 flex items-start gap-2.5 rounded-md border border-line bg-surface-2 p-3.5 text-sm text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Health checks aren’t available. {health.reason}</span>
      </div>
    );
  }
  const { api, alarms, lambdas } = health;
  const firing = alarms.filter((a) => a.state === 'ALARM');
  const errorRate = api.requests ? ((api.errors_5xx / api.requests) * 100) : 0;
  return (
    <>
      <div className={`mt-6 flex items-center gap-2.5 rounded-md border px-3.5 py-3 text-sm ${
        firing.length ? 'border-danger/30 bg-danger-soft' : 'border-accent/30 bg-accent-soft'}`}>
        {firing.length
          ? <><TriangleAlert className="h-4 w-4 shrink-0 text-danger" /> {firing.length} {firing.length === 1 ? 'alarm is' : 'alarms are'} going off.</>
          : <><CheckCircle2 className="h-4 w-4 shrink-0 text-accent" /> All systems normal.</>}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={ActivityIcon} label="API requests" value={formatCount(api.requests)} sub="last 24 hours" />
        <StatTile icon={AlertTriangle} label="Server errors (5xx)" value={formatCount(api.errors_5xx)}
          sub={api.requests ? `${errorRate.toFixed(2)}% of requests` : 'no requests'} />
        <StatTile icon={Info} label="Client errors (4xx)" value={formatCount(api.errors_4xx)} sub="expired links, bad input, throttling" />
        <StatTile icon={Timer} label="Average response" value={api.latency_ms != null ? `${Math.round(api.latency_ms)} ms` : '—'} sub="API Gateway latency" />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="panel px-4 pb-3 pt-3.5">
          <h2 className="text-sm font-semibold">Requests per hour</h2>
          <p className="mb-3 mt-0.5 text-xs text-muted">All API calls, including link downloads.</p>
          <ColumnChart title="Requests per hour" emptyText="No requests in the last 24 hours"
            points={api.hourly.map((h) => ({ key: String(h.hour), short: hourLabel(h.hour), label: `${hourLabel(h.hour)} · ${formatCount(h.errors)} errors`, value: h.requests }))} />
        </section>
        <Card title={`Alarms (${alarms.length})`}>
          {alarms.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">No alarms set up.</p> : (
            <ul className="max-h-[260px] divide-y divide-line overflow-y-auto">
              {alarms.map((a) => {
                const st = ALARM[a.state] || ALARM.INSUFFICIENT_DATA;
                return (
                  <li key={a.name} className="flex items-start gap-2.5 px-4 py-2.5" title={a.reason || undefined}>
                    <st.icon className={`mt-0.5 h-4 w-4 shrink-0 ${st.className}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs">{a.name}</div>
                      <div className="truncate text-xs text-muted">{a.description}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <div className={st.className}>{st.label}</div>
                      {a.updated_at && <div className="text-subtle" title={formatDateTime(a.updated_at)}>{formatRelative(a.updated_at)}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Functions" className="mt-3 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-2">
            <tr>
              <th className={TH}>Lambda function</th>
              <th className={`${TH} text-right`}>Calls</th>
              <th className={`${TH} text-right`}>Errors</th>
              <th className={`${TH} hidden text-right sm:table-cell`}>Throttled</th>
              <th className={`${TH} hidden text-right sm:table-cell`}>Avg time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            {lambdas.map((fn) => (
              <tr key={fn.name}>
                <td className={`${TD} max-w-0 truncate font-mono text-xs`} title={fn.name}>{fn.name}</td>
                <td className={`${TD} text-right text-muted`}>{formatCount(fn.invocations)}</td>
                <td className={`${TD} text-right ${fn.errors ? 'font-medium text-danger' : 'text-muted'}`}>
                  {fn.errors ? <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{formatCount(fn.errors)}</span> : 0}
                </td>
                <td className={`${TD} hidden text-right text-muted sm:table-cell`}>{formatCount(fn.throttles)}</td>
                <td className={`${TD} hidden text-right text-muted sm:table-cell`}>{fn.duration_ms != null ? `${Math.round(fn.duration_ms)} ms` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-4 py-2.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Config({ config: c }) {
  const mono = (v) => <span className="font-mono text-xs">{v || '—'}</span>;
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Server className="h-4 w-4 text-muted" /> Configuration</span>}>
      <dl className="divide-y divide-line">
        <Row label="Region">{mono(c.region)}</Row>
        <Row label="Environment">{mono(c.environment)}</Row>
        <Row label="Sign-in">{c.auth === 'external' ? 'External auth service' : 'Built-in (email and password)'}</Row>
        <Row label="Encryption at rest">{ENCRYPTION[c.kms_mode] || c.kms_mode}</Row>
        <Row label="Default storage limit">{c.default_quota_bytes ? formatBytes(c.default_quota_bytes) : 'No limit'}</Row>
        <Row label="Owner admins">
          {c.owner_admins.length ? c.owner_admins.join(', ') : <span className="text-muted">None (set admin_emails)</span>}
        </Row>
        <Row label="API rate limit">
          {c.api_rate_limit ? `${c.api_rate_limit} requests/s, bursts of ${c.api_burst_limit}` : '—'}
        </Row>
        <Row label="Sign-in check cache">
          {c.authorizer_cache_seconds != null ? `${c.authorizer_cache_seconds} s (how long a suspension can take)` : '—'}
        </Row>
        <Row label="Alarm emails">{c.alert_email ? 'On' : <span className="text-muted">Off (set alert_email)</span>}</Row>
        <Row label="Files bucket">{mono(c.files_bucket)}</Row>
        <Row label="Files table">{mono(c.files_table)}</Row>
        <Row label="Users table">{mono(c.users_table)}</Row>
      </dl>
    </Card>
  );
}

function Counts({ counts }) {
  const rows = [
    ['Accounts', counts.users],
    ['File records', counts.files],
    ['Short links', counts.links],
    ['Storage counters', counts.storage_counters],
    ['Days of download stats', counts.days_of_download_stats],
    ['Audit log entries', counts.audit_entries],
  ];
  return (
    <Card title="Stored records">
      <dl className="divide-y divide-line">
        {rows.map(([label, n]) => (
          <div key={label} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <dt className="text-muted">{label}</dt>
            <dd className="tabular-nums">{n.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
