import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Eye, MousePointerClick, Timer, CornerUpLeft, UserCheck, UserPlus, Upload, HardDrive, Film, Link2,
  Download, Info,
} from 'lucide-react';
import { adminApi } from '../../api/adminApi';
import { KIND_ICON, KIND_LABEL } from '../../lib/meta';
import { formatBytes, formatCount, formatDay, formatRelative, plural } from '../../lib/format';
import { Funnel, Heatmap, RetentionTable, SegmentBar } from './analyticsCharts';
import {
  DEVICE_NAME, KpiTile, LivePanel, RankList, SOURCE_NAMES, TrendCard, formatDuration, formatPct, pageName,
  useLive, zoneName,
} from './analyticsParts';
import {
  AdminError, Card, Dimmed, LoadingRows, MeterRow, PageHeader, RefreshButton, Segmented, TD, TH, UserLink,
  useAdminData,
} from './ui';

const RANGES = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];
const PERIOD = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days' };
const TZ = -new Date().getTimezoneOffset();

// Bytes on an axis: whole units are enough.
const axisBytes = (b) => formatBytes(b).replace('.0 ', ' ');

const TRAFFIC = [
  { key: 'visitors', label: 'Visitors', icon: Users, series: 'visitors' },
  { key: 'pageviews', label: 'Page views', icon: Eye, series: 'pageviews' },
  { key: 'sessions', label: 'Visits', icon: MousePointerClick, series: 'sessions' },
  { key: 'avg_session_seconds', label: 'Time per visit', icon: Timer, format: formatDuration, series: 'avg_seconds',
    note: 'Average time a visit spent with the page open and in use.' },
  { key: 'bounce_rate', label: 'Bounce rate', icon: CornerUpLeft, format: formatPct, lowerIsBetter: true,
    note: 'Visits that saw only one page.' },
  { key: 'active_users', label: 'Signed-in users', icon: UserCheck, series: 'signed_in' },
];
const PRODUCT = [
  { key: 'signups', label: 'Sign-ups', icon: UserPlus, series: 'signups' },
  { key: 'uploads', label: 'Files uploaded', icon: Upload, series: 'uploads', note: 'Counts files that are still stored.' },
  { key: 'upload_bytes', label: 'Data uploaded', icon: HardDrive, series: 'upload_bytes', format: formatBytes, axisFormat: axisBytes },
  { key: 'videos', label: 'Videos uploaded', icon: Film, series: 'videos' },
  { key: 'links', label: 'Links made', icon: Link2, series: 'links', note: 'Email shares, copied links and QR codes.' },
  { key: 'downloads', label: 'Downloads', icon: Download, series: 'downloads', note: 'Downloads through shared links.' },
];

function bucketLabels(bucket, unit) {
  const d = new Date(bucket.start);
  if (unit === 'hour') {
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return { short: time, label: `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}` };
  }
  return {
    short: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
  };
}

function Section({ title, children, aside }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {aside && <span className="text-xs text-subtle">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export default function Analytics() {
  const [range, setRange] = useState('7d');
  const load = useCallback((token) => adminApi.analytics(range, TZ, token), [range]);
  const { data, error, loading, reload } = useAdminData(load);
  const live = useLive();
  const [trafficKey, setTrafficKey] = useState('visitors');
  const [productKey, setProductKey] = useState('uploads');

  const series = useMemo(() => {
    if (!data) return null;
    const s = { ...data.series };
    s.avg_seconds = s.active_seconds.map((secs, i) => (s.sessions[i] ? Math.round(secs / s.sessions[i]) : 0));
    return s;
  }, [data]);
  const points = useCallback((key) => data.buckets.map((b, i) => ({
    key: b.start, ...bucketLabels(b, data.unit), value: series[key][i] || 0,
  })), [data, series]);

  const refresh = () => { reload(); live.reload(); };
  const period = PERIOD[range];

  if (error && !data) return <><PageHeader title="Analytics" /><div className="mt-6"><AdminError error={error} onRetry={reload} /></div></>;

  const cur = data?.kpis.cur;
  const prev = data?.kpis.prev;
  const trafficMetric = TRAFFIC.find((m) => m.key === trafficKey);
  const productMetric = PRODUCT.find((m) => m.key === productKey);
  const fmt = (m) => m.format || formatCount;
  const trackingNote = data?.tracking_since && data.buckets.length
    && new Date(`${data.tracking_since}T00:00:00Z`).getTime() > data.buckets[0].start
    ? `Visits are counted from ${formatDay(data.tracking_since)}, when analytics was turned on.` : null;

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Who visits DropVault, what they do, and how the product is used.">
        <Segmented label="Time range" value={range} onChange={setRange} options={RANGES} />
        <RefreshButton onClick={refresh} loading={loading} />
      </PageHeader>

      <div className="mt-6"><LivePanel live={live} /></div>

      {!data ? <div className="panel mt-8"><LoadingRows rows={6} /></div> : (
        <Dimmed when={loading}>
          {!data.tracking && (
            <div className="panel mt-6 flex items-start gap-3 px-4 py-3 text-sm text-muted">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              Visit tracking isn't set up in this deployment (no analytics table), so only the product numbers below are filled in.
            </div>
          )}

          {/* --- traffic ------------------------------------------------------- */}
          <Section title="Traffic" aside={`Last ${period}, compared with the ${period} before`}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {TRAFFIC.map((m) => (
                <KpiTile key={m.key} label={m.label} icon={m.icon} value={fmt(m)(cur[m.key])} cur={cur[m.key]} prev={prev[m.key]}
                  lowerIsBetter={m.lowerIsBetter} period={period}
                  spark={m.series ? series[m.series] : null}
                  active={m.series ? trafficKey === m.key : undefined}
                  onClick={m.series ? () => setTrafficKey(m.key) : undefined} />
              ))}
            </div>
            <div className="mt-3">
              <TrendCard title={trafficMetric.label} total={fmt(trafficMetric)(cur[trafficMetric.key])}
                points={points(trafficMetric.series)} format={fmt(trafficMetric)} axisFormat={trafficMetric.axisFormat}
                note={trackingNote || trafficMetric.note} emptyText="No visits in this period" />
            </div>
          </Section>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card title="When people use DropVault" action={<span className="text-xs text-subtle">Active time, your time zone</span>}>
              <div className="p-4">
                <Heatmap grid={data.heatmap} format={(v) => `${formatDuration(v)} active`} title="Active time by weekday and hour" />
              </div>
            </Card>
            <Card title="Engagement">
              <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
                {[['Daily', data.engagement.dau, 'last 24 hours'], ['Weekly', data.engagement.wau, 'last 7 days'],
                  ['Monthly', data.engagement.mau, 'last 30 days']].map(([label, n, sub]) => (
                  <div key={label} className="px-3 py-3 text-center">
                    <div className="text-xs text-muted">{label} active</div>
                    <div className="mt-0.5 text-xl font-semibold tabular-nums">{formatCount(n)}</div>
                    <div className="text-[11px] text-subtle">{sub}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-4 p-4">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>Stickiness <span className="text-xs text-muted">(daily ÷ monthly signed-in users)</span></span>
                  <span className="font-semibold tabular-nums">{formatPct(data.engagement.stickiness)}</span>
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium">New and returning visitors</div>
                  <SegmentBar label="New and returning visitors" parts={[
                    { name: 'New', value: cur.new_visitors, color: 'var(--viz-1)' },
                    { name: 'Returning', value: Math.max(0, cur.visitors - cur.new_visitors), color: 'var(--viz-2)' },
                  ]} />
                </div>
              </div>
            </Card>
          </div>

          {/* --- audience ------------------------------------------------------ */}
          <Section title="Audience" aside={`Last ${period}`}>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card title="Top pages">
                {data.pages.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">No page views yet.</p> : (
                  <table className="w-full text-sm">
                    <thead className="border-b border-line bg-surface-2">
                      <tr><th className={TH}>Page</th><th className={`${TH} text-right`}>Views</th><th className={`${TH} text-right`}>Visitors</th></tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.pages.map((p) => (
                        <tr key={p.name}>
                          <td className={`${TD} py-2.5`}>
                            <div className="font-medium">{pageName(p.name)}</div>
                            <div className="font-mono text-[11px] text-subtle">{p.name}</div>
                          </td>
                          <td className={`${TD} py-2.5 text-right tabular-nums`}>{formatCount(p.views)}</td>
                          <td className={`${TD} py-2.5 text-right text-muted tabular-nums`}>{formatCount(p.visitors)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
              <div className="grid grid-cols-1 gap-3">
                <Card title="Where visits come from">
                  <RankList rows={data.referrers} valueKey="sessions" name={(r) => SOURCE_NAMES[r.name] || r.name}
                    figure={(r) => plural(r.sessions, 'visit')} empty="No visits yet." />
                </Card>
                <Card title="First page of a visit">
                  <RankList rows={data.landing.slice(0, 5)} valueKey="sessions" name={(r) => pageName(r.name)}
                    figure={(r) => plural(r.sessions, 'visit')} empty="No visits yet." />
                </Card>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Card title="Devices">
                <div className="p-4">
                  <SegmentBar label="Visits by device" format={(v) => plural(v, 'visit')} parts={['desktop', 'mobile', 'tablet'].map((d, i) => ({
                    name: DEVICE_NAME[d], value: data.devices.find((x) => x.name === d)?.sessions || 0, color: `var(--viz-${i + 1})`,
                  }))} />
                </div>
              </Card>
              <Card title="Browsers">
                <RankList rows={data.browsers.slice(0, 5)} valueKey="sessions" empty="No visits yet." />
              </Card>
              <Card title="Operating systems">
                <RankList rows={data.systems.slice(0, 5)} valueKey="sessions" empty="No visits yet." />
              </Card>
              <Card title="Time zones" action={<span className="text-[11px] text-subtle">From the browser</span>}>
                <RankList rows={data.zones.slice(0, 5)} valueKey="sessions" name={(r) => zoneName(r.name)} empty="No visits yet." />
              </Card>
            </div>
          </Section>

          {/* --- product ------------------------------------------------------- */}
          <Section title="Product usage" aside={`Last ${period}, compared with the ${period} before`}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {PRODUCT.map((m) => (
                <KpiTile key={m.key} label={m.label} icon={m.icon} value={fmt(m)(cur[m.key])} cur={cur[m.key]} prev={prev[m.key]}
                  period={period} spark={series[m.series]} active={productKey === m.key} onClick={() => setProductKey(m.key)} />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <TrendCard kind="column" title={productMetric.label} total={fmt(productMetric)(cur[productMetric.key])}
                points={points(productMetric.series)} format={fmt(productMetric)} axisFormat={productMetric.axisFormat}
                note={productMetric.note} emptyText={`No ${productMetric.label.toLowerCase()} in this period`} />
              <TrendCard title="Storage held" total={formatBytes(series.storage_bytes[series.storage_bytes.length - 1] || 0)}
                points={points('storage_bytes')} format={formatBytes} axisFormat={axisBytes}
                note="Size of the files still stored, by when they were uploaded." emptyText="Nothing stored yet" />
            </div>
          </Section>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card title="File types">
              <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
                {[['Files', formatCount(data.files.total_files)], ['Stored', formatBytes(data.files.total_bytes)],
                  ['Videos', formatCount(data.files.videos.files)]].map(([label, value]) => (
                  <div key={label} className="px-3 py-3 text-center">
                    <div className="text-xs text-muted">{label}</div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
                  </div>
                ))}
              </div>
              {data.files.by_kind.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">No files yet.</p> : (
                <ul className="px-4 py-1.5">
                  {data.files.by_kind.map((k) => {
                    const Icon = KIND_ICON[k.kind] || KIND_ICON.file;
                    return (
                      <MeterRow key={k.kind}
                        label={<span className="inline-flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 text-muted" />{KIND_LABEL[k.kind] || k.kind}</span>}
                        figure={`${plural(k.files, 'file')} · ${formatBytes(k.bytes)}${k.new ? ` · +${k.new}` : ''}`}
                        pct={data.files.total_bytes ? (k.bytes / data.files.total_bytes) * 100 : 0} />
                    );
                  })}
                </ul>
              )}
            </Card>
            <Card title="File sizes">
              <RankList rows={data.files.sizes.map((s) => ({ name: s.label, files: s.files }))} valueKey="files"
                figure={(r) => plural(r.files, 'file')} empty="No files yet." />
            </Card>
            <Card title="Most downloaded files">
              {data.files.top_downloaded.length === 0
                ? <p className="px-4 py-8 text-center text-sm text-muted">No downloads yet.</p>
                : (
                  <ul className="divide-y divide-line">
                    {data.files.top_downloaded.map((f) => {
                      const Icon = KIND_ICON[f.kind] || KIND_ICON.file;
                      return (
                        <li key={f.file_id} className="flex items-center gap-3 px-4 py-2.5">
                          <Icon className="h-4 w-4 shrink-0 text-muted" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium" title={f.file_name}>{f.file_name}</div>
                            <div className="truncate text-xs text-muted"><UserLink user={f.owner} /> · {formatBytes(f.size)}</div>
                          </div>
                          <span className="shrink-0 text-xs text-muted tabular-nums">{plural(f.downloads, 'download')}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </Card>
          </div>

          {/* --- growth ---------------------------------------------------------- */}
          <Section title="Growth and retention">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <Card title="From visit to download" action={<span className="text-xs text-subtle">Last {period}</span>}>
                <div className="p-4">
                  <Funnel steps={data.funnel} />
                  <p className="mt-4 text-[11px] text-subtle">
                    Steps 3 to 5 follow the accounts made in this period: did they upload, share and get a download.
                  </p>
                </div>
              </Card>
              <Card title="Weekly retention" action={<span className="text-xs text-subtle">Share of each week's sign-ups who came back</span>}>
                <div className="p-3">
                  <RetentionTable rows={data.retention} />
                  <p className="px-2 pt-2 text-[11px] text-subtle">Weeks run Monday to Sunday; a week shows once it's over.</p>
                </div>
              </Card>
            </div>
          </Section>

          {/* --- people -------------------------------------------------------- */}
          <Section title="Most active accounts" aside={`Last ${period}`}>
            <div className="panel overflow-hidden">
              {data.top_users.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted">No signed-in activity in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-surface-2">
                    <tr>
                      <th className={TH}>Account</th>
                      <th className={`${TH} text-right`}>Active time</th>
                      <th className={`${TH} hidden text-right sm:table-cell`}>Visits</th>
                      <th className={`${TH} hidden text-right sm:table-cell`}>Page views</th>
                      <th className={`${TH} hidden md:table-cell`}>Last seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.top_users.map((u) => {
                      const online = live.data?.users?.[u.user_id]?.online;
                      return (
                        <tr key={u.user_id}>
                          <td className={`${TD} py-2.5`}>
                            <UserLink user={u} className="font-medium" />
                            {online && <span className="ml-2 text-xs text-viz-good">Online now</span>}
                          </td>
                          <td className={`${TD} py-2.5 text-right tabular-nums`}>{formatDuration(u.active_seconds)}</td>
                          <td className={`${TD} hidden py-2.5 text-right text-muted tabular-nums sm:table-cell`}>{formatCount(u.sessions)}</td>
                          <td className={`${TD} hidden py-2.5 text-right text-muted tabular-nums sm:table-cell`}>{formatCount(u.pageviews)}</td>
                          <td className={`${TD} hidden py-2.5 text-muted md:table-cell`}>{online ? 'Now' : formatRelative(u.last_seen_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <p className="mt-3 text-[11px] text-subtle">
              Visits are counted from a heartbeat the site sends every 30 seconds while a tab is open and in use. Visitors who
              aren't signed in are counted by a random id kept in their browser; no IP addresses are stored.
              {' '}<Link to="/admin/users" className="link">See every account</Link>
            </p>
          </Section>
        </Dimmed>
      )}
    </div>
  );
}
