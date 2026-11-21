import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Files, HardDrive, Link2, Download, ArrowRight } from 'lucide-react';
import { adminApi } from '../../api/adminApi';
import { KIND_LABEL, LINK_STATUS, CHANNEL } from '../../lib/meta';
import { formatBytes, formatCount, formatDay, plural } from '../../lib/format';
import { ChartCard } from './charts';
import ActivityList from './ActivityList';
import {
  useAdminData, PageHeader, RefreshButton, StatTile, Card, MeterRow, Segmented, Dimmed, AdminError,
  LoadingRows, quotaTone, EmptyState,
} from './ui';

const RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

// Daily numbers -> chart points: one per day up to a month, then one per week.
function toPoints(daily, field) {
  if (daily.length <= 31) {
    return daily.map((d) => ({ key: d.date, short: formatDay(d.date), label: formatDay(d.date), value: d[field] }));
  }
  const points = [];
  for (let end = daily.length; end > 0; end -= 7) {
    const week = daily.slice(Math.max(0, end - 7), end);
    const first = week[0].date;
    const last = week[week.length - 1].date;
    points.unshift({
      key: first, short: formatDay(first), label: `${formatDay(first)} – ${formatDay(last)}`,
      value: week.reduce((n, d) => n + d[field], 0),
    });
  }
  return points;
}

export default function Overview() {
  const { data, error, loading, reload } = useAdminData(adminApi.overview);
  const [days, setDays] = useState(30);

  const daily = useMemo(() => (data?.daily || []).slice(-days), [data, days]);
  const sum = (field) => daily.reduce((n, d) => n + d[field], 0);
  const period = `${days} days`;

  if (error && !data) return <><PageHeader title="Overview" /><div className="mt-6"><AdminError error={error} onRetry={reload} /></div></>;

  const t = data?.totals;
  const since = data?.downloads_counted_since;
  const downloadsNote = since && daily.length && since > daily[0].date
    ? `Downloads are counted from ${formatDay(since)}, when the admin panel was set up.` : null;

  return (
    <div>
      <PageHeader title="Overview" subtitle="Everything happening across DropVault.">
        <Segmented label="Time range" value={days} onChange={setDays} options={RANGES} />
        <RefreshButton onClick={reload} loading={loading} />
      </PageHeader>

      {!data ? <div className="panel mt-6"><LoadingRows rows={5} /></div> : (
        <Dimmed when={loading}>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile icon={Users} label="Users" value={formatCount(t.users)}
              sub={`+${formatCount(sum('signups'))} in ${period}${t.suspended ? ` · ${t.suspended} suspended` : ''}`} />
            <StatTile icon={Files} label="Files" value={formatCount(t.files)}
              sub={`+${formatCount(sum('uploads'))} in ${period}${t.uploading ? ` · ${t.uploading} uploading` : ''}`} />
            <StatTile icon={HardDrive} label="Storage used" value={formatBytes(t.storage_bytes)}
              sub={`+${formatBytes(sum('upload_bytes'))} in ${period}`} />
            <StatTile icon={Link2} label="Active links" value={formatCount(t.active_links)}
              sub={`of ${plural(t.links, 'link')} · ${formatCount(sum('links'))} new`} />
            <StatTile icon={Download} label="Downloads" value={formatCount(t.downloads)} className="col-span-2 lg:col-span-1"
              sub={`${formatCount(sum('downloads'))} in ${period}`} />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <ChartCard title="New users" total={formatCount(sum('signups'))} points={toPoints(daily, 'signups')}
              emptyText="No sign-ups in this period" />
            <ChartCard title="Uploads" total={formatCount(sum('uploads'))} points={toPoints(daily, 'uploads')}
              emptyText="No uploads in this period" note="Counts files that are still stored." />
            <ChartCard title="Links made" total={formatCount(sum('links'))} points={toPoints(daily, 'links')}
              emptyText="No links made in this period" note="Email shares, copied links and QR codes." />
            <ChartCard title="Downloads" total={formatCount(sum('downloads'))} points={toPoints(daily, 'downloads')}
              emptyText="No downloads in this period" note={downloadsNote || 'Downloads through shared links.'} />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card title="Storage by file type">
              {data.storage_by_kind.length === 0
                ? <p className="px-4 py-8 text-center text-sm text-muted">No files yet.</p>
                : (
                  <ul className="px-4 py-1.5">
                    {data.storage_by_kind.map((k) => (
                      <MeterRow key={k.kind} label={KIND_LABEL[k.kind] || k.kind}
                        figure={`${formatBytes(k.bytes)} · ${plural(k.files, 'file')}`}
                        pct={t.storage_bytes ? (k.bytes / t.storage_bytes) * 100 : 0} />
                    ))}
                  </ul>
                )}
            </Card>

            <Card title="Top users by storage" action={<Link to="/admin/users" className="text-xs font-medium text-muted hover:text-fg">All users</Link>}>
              {data.top_users.length === 0
                ? <p className="px-4 py-8 text-center text-sm text-muted">Nobody has stored anything yet.</p>
                : (
                  <ul className="px-4 py-1.5">
                    {data.top_users.map((u) => {
                      const pct = u.quota_bytes ? (u.used_bytes / u.quota_bytes) * 100 : 0;
                      return (
                        <MeterRow key={u.user_id}
                          label={<Link to={`/admin/users/${encodeURIComponent(u.user_id)}`} className="hover:underline underline-offset-2">{u.name || u.email}</Link>}
                          figure={u.quota_bytes ? `${formatBytes(u.used_bytes)} of ${formatBytes(u.quota_bytes)}` : `${formatBytes(u.used_bytes)} · no limit`}
                          pct={u.quota_bytes ? pct : 100} tone={u.quota_bytes ? quotaTone(pct) : 'accent'}
                          title={u.email} />
                      );
                    })}
                  </ul>
                )}
            </Card>
          </div>

          <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Card title="Links" action={<Link to="/admin/links" className="text-xs font-medium text-muted hover:text-fg">All links</Link>}>
              {t.links === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">No links made yet.</p> : (
                <>
                  <ul className="px-4 py-1.5">
                    {Object.entries(data.links_by_status).filter(([, n]) => n > 0).map(([status, n]) => (
                      <MeterRow key={status} label={LINK_STATUS[status]?.label || status} figure={formatCount(n)}
                        pct={(n / t.links) * 100} />
                    ))}
                  </ul>
                  <div className="grid grid-cols-3 divide-x divide-line border-t border-line">
                    {Object.entries(data.links_by_channel).map(([channel, n]) => {
                      const ch = CHANNEL[channel];
                      return (
                        <div key={channel} className="px-3 py-3 text-center">
                          <ch.icon className="mx-auto h-4 w-4 text-muted" />
                          <div className="mt-1 text-sm font-semibold">{formatCount(n)}</div>
                          <div className="text-[11px] text-muted">{ch.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </Card>

            <Card title="Recent activity" action={
              <Link to="/admin/activity" className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>}>
              {data.recent.length === 0
                ? <EmptyState title="Nothing yet">Sign-ups, uploads and shares will show up here.</EmptyState>
                : <ActivityList events={data.recent} />}
            </Card>
          </div>
        </Dimmed>
      )}
    </div>
  );
}
