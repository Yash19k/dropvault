import { useMemo, useState } from 'react';
import { Files as FilesIcon } from 'lucide-react';
import { adminApi } from '../../api/adminApi';
import { KIND_LABEL } from '../../lib/meta';
import { formatBytes, plural } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { FileTable } from './tables';
import {
  useAdminData, usePaged, PageHeader, RefreshButton, ExportButton, Toolbar, SearchInput, FilterSelect,
  Pagination, Dimmed, AdminError, LoadingRows, EmptyState,
} from './ui';

const STATUSES = { all: 'Any status', READY: 'Ready', UPLOADING: 'Uploading' };
const TYPES = { all: 'All types', ...KIND_LABEL };
const SORTS = { newest: 'Newest first', size: 'Largest first', downloads: 'Most downloaded', name: 'Name' };
const ORDER = {
  newest: (a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''),
  size: (a, b) => b.size - a.size,
  downloads: (a, b) => b.download_count - a.download_count,
  name: (a, b) => a.file_name.localeCompare(b.file_name),
};

const CSV_COLUMNS = [
  { label: 'File', value: (f) => f.file_name },
  { label: 'File ID', value: (f) => f.file_id },
  { label: 'Type', value: (f) => KIND_LABEL[f.kind] },
  { label: 'Content type', value: (f) => f.content_type },
  { label: 'Size (bytes)', value: (f) => f.size },
  { label: 'Status', value: (f) => f.status },
  { label: 'Owner email', value: (f) => f.owner?.email },
  { label: 'Owner ID', value: (f) => f.owner?.user_id },
  { label: 'Uploaded', value: (f) => f.uploaded_at },
  { label: 'Downloads', value: (f) => f.download_count },
  { label: 'Links', value: (f) => f.link_count },
  { label: 'Active links', value: (f) => f.active_links },
];

export default function AdminFiles() {
  const { data, error, loading, reload, token } = useAdminData(adminApi.files);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('newest');

  const files = data?.files;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (files || [])
      .filter((f) => status === 'all' || f.status === status)
      .filter((f) => type === 'all' || f.kind === type)
      .filter((f) => !q || f.file_name.toLowerCase().includes(q) || (f.owner?.email || '').includes(q)
        || (f.owner?.name || '').toLowerCase().includes(q) || f.file_id === q)
      .sort(ORDER[sort]);
  }, [files, query, status, type, sort]);
  const paged = usePaged(visible, `${query}|${status}|${type}|${sort}`);

  const totalBytes = (files || []).filter((f) => f.status === 'READY').reduce((n, f) => n + f.size, 0);

  if (error && !data) return <><PageHeader title="Files" /><div className="mt-6"><AdminError error={error} onRetry={reload} /></div></>;

  return (
    <div>
      <PageHeader title="Files" subtitle={files ? `${plural(files.length, 'file')} · ${formatBytes(totalBytes)} stored` : 'Every file in DropVault.'}>
        <ExportButton disabled={!visible.length}
          onClick={() => downloadCsv(`dropvault-files-${new Date().toISOString().slice(0, 10)}.csv`, CSV_COLUMNS, visible)} />
        <RefreshButton onClick={reload} loading={loading} />
      </PageHeader>

      <Toolbar>
        <SearchInput value={query} onChange={setQuery} placeholder="Search by file or owner…" label="Search files" />
        <FilterSelect value={type} onChange={setType} options={TYPES} label="File type" />
        <FilterSelect value={status} onChange={setStatus} options={STATUSES} label="Status" />
        <FilterSelect value={sort} onChange={setSort} options={SORTS} label="Sort files" />
      </Toolbar>

      <div className="panel mt-4 overflow-hidden">
        {!data && <LoadingRows />}
        {data && visible.length === 0 && (
          <EmptyState icon={FilesIcon} title={files.length ? 'No files match' : 'No files yet'}>
            {files.length ? 'Try a different search or filter.' : 'Files appear here as soon as anyone uploads one.'}
          </EmptyState>
        )}
        {visible.length > 0 && (
          <Dimmed when={loading}>
            <FileTable files={paged.slice} token={token} onChanged={reload} />
            <Pagination {...paged} noun="files" />
          </Dimmed>
        )}
      </div>
      {visible.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Downloading someone’s file is recorded in the activity log.
        </p>
      )}
    </div>
  );
}
