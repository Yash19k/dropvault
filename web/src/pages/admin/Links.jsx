import { useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import { adminApi } from '../../api/adminApi';
import { CHANNEL, LINK_STATUS } from '../../lib/meta';
import { plural } from '../../lib/format';
import { downloadCsv, isoTime } from '../../lib/csv';
import { LinkTable } from './tables';
import {
  useAdminData, usePaged, PageHeader, RefreshButton, ExportButton, Toolbar, SearchInput, FilterSelect,
  Pagination, Dimmed, AdminError, LoadingRows, EmptyState,
} from './ui';

const STATUSES = { all: 'Any status', ...Object.fromEntries(Object.entries(LINK_STATUS).map(([k, v]) => [k, v.label])) };
const CHANNELS = { all: 'Any kind', ...Object.fromEntries(Object.entries(CHANNEL).map(([k, v]) => [k, v.label])) };
const SORTS = { newest: 'Newest first', downloads: 'Most downloaded', recent: 'Last downloaded' };
const ORDER = {
  newest: (a, b) => (b.created_at || 0) - (a.created_at || 0),
  downloads: (a, b) => b.downloads - a.downloads,
  recent: (a, b) => (b.last_downloaded_at || 0) - (a.last_downloaded_at || 0),
};

const CSV_COLUMNS = [
  { label: 'Code', value: (l) => l.code },
  { label: 'URL', value: (l) => l.url },
  { label: 'Kind', value: (l) => CHANNEL[l.channel]?.label },
  { label: 'Recipient', value: (l) => l.recipient },
  { label: 'File', value: (l) => l.file?.file_name },
  { label: 'Owner email', value: (l) => l.owner?.email },
  { label: 'Status', value: (l) => LINK_STATUS[l.status]?.label },
  { label: 'Downloads', value: (l) => l.downloads },
  { label: 'Download limit', value: (l) => l.max_downloads },
  { label: 'Made', value: (l) => isoTime(l.created_at) },
  { label: 'Expires', value: (l) => (l.expires_at ? isoTime(l.expires_at * 1000) : 'never') },
  { label: 'Last downloaded', value: (l) => isoTime(l.last_downloaded_at && l.last_downloaded_at * 1000) },
];

export default function AdminLinks() {
  const { data, error, loading, reload, token } = useAdminData(adminApi.links);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [channel, setChannel] = useState('all');
  const [sort, setSort] = useState('newest');

  const links = data?.links;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (links || [])
      .filter((l) => status === 'all' || l.status === status)
      .filter((l) => channel === 'all' || l.channel === channel)
      .filter((l) => !q || (l.file?.file_name || '').toLowerCase().includes(q) || (l.owner?.email || '').includes(q)
        || (l.recipient || '').toLowerCase().includes(q) || l.code.toLowerCase() === q)
      .sort(ORDER[sort]);
  }, [links, query, status, channel, sort]);
  const paged = usePaged(visible, `${query}|${status}|${channel}|${sort}`);
  const active = (links || []).filter((l) => l.status === 'active').length;

  if (error && !data) return <><PageHeader title="Links" /><div className="mt-6"><AdminError error={error} onRetry={reload} /></div></>;

  return (
    <div>
      <PageHeader title="Links" subtitle={links ? `${plural(links.length, 'link')} · ${active} active` : 'Every link shared from DropVault.'}>
        <ExportButton disabled={!visible.length}
          onClick={() => downloadCsv(`dropvault-links-${new Date().toISOString().slice(0, 10)}.csv`, CSV_COLUMNS, visible)} />
        <RefreshButton onClick={reload} loading={loading} />
      </PageHeader>

      <Toolbar>
        <SearchInput value={query} onChange={setQuery} placeholder="Search by file, owner or recipient…" label="Search links" />
        <FilterSelect value={status} onChange={setStatus} options={STATUSES} label="Status" />
        <FilterSelect value={channel} onChange={setChannel} options={CHANNELS} label="Kind of link" />
        <FilterSelect value={sort} onChange={setSort} options={SORTS} label="Sort links" />
      </Toolbar>

      <div className="panel mt-4 overflow-hidden">
        {!data && <LoadingRows />}
        {data && visible.length === 0 && (
          <EmptyState icon={Link2} title={links.length ? 'No links match' : 'No links yet'}>
            {links.length ? 'Try a different search or filter.' : 'Email shares, copied links and QR codes show up here.'}
          </EmptyState>
        )}
        {visible.length > 0 && (
          <Dimmed when={loading}>
            <LinkTable links={paged.slice} token={token} onChanged={reload} />
            <Pagination {...paged} noun="links" />
          </Dimmed>
        )}
      </div>
      {visible.length > 0 && (
        <p className="mt-3 text-xs text-muted">Links are removed 30 days after they expire, and when their file is deleted.</p>
      )}
    </div>
  );
}
