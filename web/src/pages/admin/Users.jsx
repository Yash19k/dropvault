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

const FILTERS = {
  all: 'All users',
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
  seen: 'Last sign-in',
};

const usedPct = (u) => (u.quota_bytes ? (u.used_bytes / u.quota_bytes) * 100 : 0);

const MATCH = {
  all: () => true,
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
  seen: (a, b) => (b.last_login_at || 0) - (a.last_login_at || 0),
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
];

export default function Users() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAdminData(adminApi.users);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');

  const users = data?.users;
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
        subtitle={users ? `${plural(users.length, 'account')} · ${plural(admins, 'admin')}${suspended ? ` · ${suspended} suspended` : ''}` : 'Every account in DropVault.'}>
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
                  <th className={`${TH} hidden lg:table-cell`}>Last sign-in</th>
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
                          <Avatar name={u.name} email={u.email} />
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <Link to={href} className="truncate font-medium hover:underline underline-offset-2" onClick={(e) => e.stopPropagation()}>
                                {u.name || u.email}
                              </Link>
                              <AccountBadges user={u} />
                            </div>
                            <div className="truncate text-xs text-muted">
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
                      <td className={`${TD} hidden whitespace-nowrap text-muted lg:table-cell`}
                        title={u.last_login_at ? formatDateTime(u.last_login_at * 1000) : undefined}>
                        {u.last_login_at ? formatRelative(u.last_login_at * 1000) : 'Never'}
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
