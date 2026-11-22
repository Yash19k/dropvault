import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Users as UsersIcon } from 'lucide-react';
import { adminApi } from '../../api/adminApi';
import { formatBytes, formatDate, formatRelative, formatDateTime, plural } from '../../lib/format';
import { downloadCsv, isoTime } from '../../lib/csv';
import {
  useAdminData, usePaged, PageHeader, RefreshButton, ExportButton, Toolbar, SearchInput, FilterSelect,
  Pagination, Dimmed, AdminError, LoadingRows, EmptyState, Avatar, AccountBadges, quotaTone, TH, TD,
} from './ui';
import { OnlineDot, useLive } from './analyticsParts';

const FILTERS = {
  all: 'All users',
  online: 'Online now',
  admins: 'Admins',
  suspended: 'Suspended',
  no_files: 'No files yet',
  near_limit: 'Near storage limit',
};
const SORTS = {
  newest: 'Newest first',
  name: 'Name',
  storage: 'Most storage',
  files: 'Most files',
  seen: 'Last seen',
};

// When the account was last on the site: its newest heartbeat, or else its last sign-in.
const lastSeen = (u) => Math.max(u.last_seen_at || 0, (u.last_login_at || 0) * 1000);

const usedPct = (u) => (u.quota_bytes ? (u.used_bytes / u.quota_bytes) * 100 : 0);

const MATCH = {
  all: () => true,
  online: (u) => u.online,
  admins: (u) => u.role === 'admin',
  suspended: (u) => u.suspended,
  no_files: (u) => u.file_count === 0,
  near_limit: (u) => usedPct(u) >= 80,
};
const ORDER = {
  newest: (a, b) => (b.created_at || 0) - (a.created_at || 0),
  name: (a, b) => (a.name || a.email).localeCompare(b.name || b.email),
  storage: (a, b) => b.used_bytes - a.used_bytes,
  files: (a, b) => b.file_count - a.file_count,
  seen: (a, b) => (Number(b.online) - Number(a.online)) || (lastSeen(b) - lastSeen(a)),
};

const CSV_COLUMNS = [
  { label: 'Name', value: (u) => u.name },
  { label: 'Email', value: (u) => u.email },
  { label: 'User ID', value: (u) => u.user_id },
  { label: 'Role', value: (u) => (u.owner ? 'owner' : u.role) },
  { label: 'Suspended', value: (u) => (u.suspended ? 'yes' : 'no') },
  { label: 'Files', value: (u) => u.file_count },
  { label: 'Storage used (bytes)', value: (u) => u.used_bytes },
  { label: 'Storage limit (bytes, 0 = none)', value: (u) => u.quota_bytes },
  { label: 'Links', value: (u) => u.link_count },
  { label: 'Active links', value: (u) => u.active_links },
  { label: 'Downloads', value: (u) => u.downloads },
  { label: 'Sign-ins', value: (u) => u.login_count },
  { label: 'Joined', value: (u) => isoTime(u.created_at * 1000) },
  { label: 'Last sign-in', value: (u) => isoTime(u.last_login_at && u.last_login_at * 1000) },
  { label: 'Online now', value: (u) => (u.online ? 'yes' : 'no') },
  { label: 'Last seen', value: (u) => isoTime(lastSeen(u) || null) },
];

export default function Users() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAdminData(adminApi.users);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');

  // Who is online is polled every 15 seconds, so the dots stay current
  // without reloading the whole list.
  const live = useLive();
  const users = useMemo(() => {
    const seen = live.data?.users;
    if (!data?.users || !seen) return data?.users;
    return data.users.map((u) => (seen[u.user_id]
      ? { ...u, online: seen[u.user_id].online, last_seen_at: Math.max(u.last_seen_at || 0, seen[u.user_id].last_seen_at) }
      : { ...u, online: false }));
  }, [data, live.data]);
  const online = (users || []).filter((u) => u.online).length;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users || [])
      .filter((u) => MATCH[filter](u))
      .filter((u) => !q || (u.name || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.user_id === q)
      .sort(ORDER[sort]);
  }, [users, query, filter, sort]);
  const paged = usePaged(visible, `${query}|${filter}|${sort}`);

  const admins = (users || []).filter((u) => u.role === 'admin').length;
  const suspended = (users || []).filter((u) => u.suspended).length;

  if (error && !data) return <><PageHeader title="Users" /><div className="mt-6"><AdminError error={error} onRetry={reload} /></div></>;

  return (
    <div>
      <PageHeader title="Users"
        subtitle={users ? `${plural(users.length, 'account')} · ${online} online now · ${plural(admins, 'admin')}${suspended ? ` · ${suspended} suspended` : ''}` : 'Every account in DropVault.'}>
        <ExportButton disabled={!visible.length}
          onClick={() => downloadCsv(`dropvault-users-${new Date().toISOString().slice(0, 10)}.csv`, CSV_COLUMNS, visible)} />
        <RefreshButton onClick={reload} loading={loading} />
      </PageHeader>

      <Toolbar>
        <SearchInput value={query} onChange={setQuery} placeholder="Search by name or email…" label="Search users" />
        <FilterSelect value={filter} onChange={setFilter} options={FILTERS} label="Show" />
        <FilterSelect value={sort} onChange={setSort} options={SORTS} label="Sort users" />
      </Toolbar>

      <div className="panel mt-4 overflow-hidden">
        {!data && <LoadingRows />}
        {data && visible.length === 0 && (
          <EmptyState icon={UsersIcon} title={users.length ? 'No users match' : 'No users yet'}>
            {users.length ? 'Try a different search or filter.' : 'Accounts appear here as soon as people sign up.'}
          </EmptyState>
        )}
        {visible.length > 0 && (
          <Dimmed when={loading}>
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-2">
                <tr>
                  <th className={TH}>User</th>
                  <th className={`${TH} hidden text-right md:table-cell`}>Files</th>
                  <th className={`${TH} hidden sm:table-cell`}>Storage</th>
                  <th className={`${TH} hidden lg:table-cell`}>Last seen</th>
                  <th className={`${TH} hidden xl:table-cell`}>Joined</th>
                  <th className={TH}><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {paged.slice.map((u) => {
                  const pct = usedPct(u);
                  const tone = quotaTone(pct);
                  const href = `/admin/users/${encodeURIComponent(u.user_id)}`;
                  return (
                    <tr key={u.user_id} className="cursor-pointer transition-colors hover:bg-surface-2" onClick={() => navigate(href)}>
                      <td className={`${TD} w-full max-w-0`}>
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="relative shrink-0">
                            <Avatar name={u.name} email={u.email} />
                            {u.online && <OnlineDot className="absolute -bottom-0.5 -right-0.5" />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <Link to={href} className="truncate font-medium hover:underline underline-offset-2" onClick={(e) => e.stopPropagation()}>
                                {u.name || u.email}
                              </Link>
                              <AccountBadges user={u} />
                            </div>
                            <div className="truncate text-xs text-muted">
                              {u.online && <span className="font-medium text-viz-good lg:hidden">Online now · </span>}
                              {u.email}
                              <span className="sm:hidden"> · {formatBytes(u.used_bytes)}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={`${TD} hidden text-right text-muted tabular-nums md:table-cell`}>
                        {u.file_count.toLocaleString()}
                      </td>
                      <td className={`${TD} hidden sm:table-cell`}>
                        <div className="flex w-40 items-baseline justify-between gap-2 whitespace-nowrap text-xs tabular-nums">
                          <span className="font-medium text-fg">{formatBytes(u.used_bytes)}</span>
                          <span className="text-muted">{u.quota_bytes ? `of ${formatBytes(u.quota_bytes)}` : 'no limit'}</span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                          <div className={`h-full rounded-full ${tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-amber-500' : 'bg-accent'}`}
                            style={{ width: `${u.quota_bytes ? Math.min(100, Math.max(u.used_bytes ? 1 : 0, pct)) : 0}%` }} />
                        </div>
                      </td>
                      <td className={`${TD} hidden whitespace-nowrap lg:table-cell`}
                        title={lastSeen(u) ? formatDateTime(lastSeen(u)) : undefined}>
                        {u.online
                          ? <span className="inline-flex items-center gap-1.5 font-medium text-viz-good"><OnlineDot className="ring-0" /> Online now</span>
                          : <span className="text-muted">{lastSeen(u) ? formatRelative(lastSeen(u)) : 'Never'}</span>}
                      </td>
                      <td className={`${TD} hidden whitespace-nowrap text-muted xl:table-cell`}>
                        {u.created_at ? formatDate(u.created_at * 1000) : '—'}
                      </td>
                      <td className={`${TD} w-8 pl-0`}><ChevronRight className="h-4 w-4 text-subtle" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination {...paged} noun="users" />
          </Dimmed>
        )}
      </div>
    </div>
  );
}
