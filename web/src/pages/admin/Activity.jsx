import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { adminApi } from '../../api/adminApi';
import { plural } from '../../lib/format';
import { ActivityItem, EVENT_TYPES } from './ActivityList';
import {
  useAdminData, PageHeader, RefreshButton, Toolbar, SearchInput, FilterSelect, Dimmed, AdminError,
  LoadingRows, EmptyState,
} from './ui';

const STEP = 100;

function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Text an event can be found by.
function haystack(e) {
  return [e.user?.name, e.user?.email, e.file?.file_name, e.recipient, e.summary, e.actor?.email, e.actor?.name]
    .filter(Boolean).join(' ').toLowerCase();
}

export default function Activity() {
  const { data, error, loading, reload } = useAdminData(adminApi.activity);
  const [type, setType] = useState('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(STEP);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.events || []).filter((e) => (type === 'all' || e.type === type) && (!q || haystack(e).includes(q)));
  }, [data, type, query]);

  const groups = useMemo(() => {
    const out = [];
    visible.slice(0, shown).forEach((e) => {
      const label = dayLabel(e.at);
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, events: [] });
      out[out.length - 1].events.push(e);
    });
    return out;
  }, [visible, shown]);

  if (error && !data) return <><PageHeader title="Activity" /><div className="mt-6"><AdminError error={error} onRetry={reload} /></div></>;

  return (
    <div>
      <PageHeader title="Activity" subtitle="Sign-ups, uploads, shares, downloads, and every action taken in the admin panel.">
        <RefreshButton onClick={reload} loading={loading} />
      </PageHeader>

      <Toolbar>
        <SearchInput value={query} onChange={(v) => { setQuery(v); setShown(STEP); }} placeholder="Search people, files, actions…" label="Search activity" />
        <FilterSelect value={type} onChange={(v) => { setType(v); setShown(STEP); }} options={EVENT_TYPES} label="Kind of activity" />
      </Toolbar>

      {!data && <div className="panel mt-4"><LoadingRows rows={6} /></div>}
      {data && visible.length === 0 && (
        <div className="panel mt-4">
          <EmptyState icon={History} title={data.events.length ? 'Nothing matches' : 'No activity yet'}>
            {data.events.length ? 'Try a different search or kind of activity.' : 'Things people do in DropVault will show up here.'}
          </EmptyState>
        </div>
      )}
      {groups.length > 0 && (
        <Dimmed when={loading}>
          <div className="mt-4 space-y-4">
            {groups.map((g) => (
              <section key={g.label} className="panel overflow-hidden">
                <h2 className="border-b border-line bg-surface-2 px-4 py-2 text-xs font-medium text-muted">{g.label}</h2>
                <ul className="divide-y divide-line">
                  {g.events.map((e, i) => <ActivityItem key={`${e.type}-${e.at}-${i}`} event={e} />)}
                </ul>
              </section>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
            <span>
              Showing {Math.min(shown, visible.length).toLocaleString()} of {plural(visible.length, 'event')}
              {data.total > data.events.length ? ` (the latest ${data.events.length.toLocaleString()} of ${data.total.toLocaleString()})` : ''}.
              Downloads show each link’s most recent one. Admin actions are kept for a year.
            </span>
            {shown < visible.length && (
              <button className="btn-secondary" onClick={() => setShown((n) => n + STEP)}>Show more</button>
            )}
          </div>
        </Dimmed>
      )}
    </div>
  );
}
