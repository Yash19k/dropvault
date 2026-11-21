import { Link } from 'react-router-dom';
import { HeartPulse, Server, ArrowRight } from 'lucide-react';
import { adminApi } from '../../api/adminApi';
import { formatBytes } from '../../lib/format';
import { useAdminData, PageHeader, RefreshButton, Card, Dimmed, AdminError, LoadingRows } from './ui';

const ENCRYPTION = {
  s3: 'SSE-S3 (Amazon S3 managed keys)',
  shared: 'One KMS key for the app',
  per_user: 'One KMS key per user',
};

export default function System() {
  const { data, error, loading, reload } = useAdminData(adminApi.system);

  if (error && !data) return <><PageHeader title="System" /><div className="mt-6"><AdminError error={error} onRetry={reload} /></div></>;

  return (
    <div>
      <PageHeader title="System" subtitle="How this deployment is set up, and what it stores.">
        <RefreshButton onClick={reload} loading={loading} />
      </PageHeader>

      <Link to="/admin/health"
        className="panel mt-6 flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2">
        <HeartPulse className="h-4 w-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">Health</span>
          <span className="text-muted"> · live checks, traffic, errors and alarms</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
      </Link>

      {!data ? <div className="panel mt-3"><LoadingRows /></div> : (
        <Dimmed when={loading}>
          <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Config config={data.config} />
            <Counts counts={data.counts} />
          </div>
        </Dimmed>
      )}
    </div>
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
