// File and link tables, used by the Files and Links pages and on a user's page.
import { useState } from 'react';
import { Download, Link2Off, Trash2, Copy, Check } from 'lucide-react';
import { Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { adminApi } from '../../api/adminApi';
import { KIND_ICON, KIND_LABEL, CHANNEL, LINK_STATUS } from '../../lib/meta';
import { formatBytes, formatDate, formatDateTime, formatRelative, plural } from '../../lib/format';
import { Badge, ConfirmDialog, TH, TD, UserLink, useAction } from './ui';

function saveFrom(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const ownerName = (owner) => owner?.email || 'a deleted account';

export function FileTable({ files, token, onChanged, showOwner = true }) {
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState(null); // { kind: 'delete' | 'links', file }

  const download = (f) => run(`dl-${f.file_id}`, async () => {
    const r = await adminApi.downloadFile(f.file_id, token);
    saveFrom(r.download_url);
  }).catch(() => {});

  return (
    <>
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-surface-2">
          <tr>
            <th className={TH}>File</th>
            {showOwner && <th className={`${TH} hidden md:table-cell`}>Owner</th>}
            <th className={`${TH} hidden text-right sm:table-cell`}>Size</th>
            <th className={`${TH} hidden lg:table-cell`}>Uploaded</th>
            <th className={`${TH} hidden text-right lg:table-cell`}>Downloads</th>
            <th className={`${TH} hidden xl:table-cell`}>Links</th>
            <th className={TH}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {files.map((f) => {
            const Icon = KIND_ICON[f.kind] || KIND_ICON.file;
            const ready = f.status === 'READY';
            return (
              <tr key={f.file_id} className="transition-colors hover:bg-surface-2">
                <td className={`${TD} w-full max-w-0`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium" title={f.file_name}>{f.file_name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                        {!ready && <Badge tone="outline">Uploading</Badge>}
                        <span className="truncate">
                          {KIND_LABEL[f.kind] || 'File'}
                          <span className="sm:hidden"> · {formatBytes(f.size)}</span>
                          {showOwner && <span className="md:hidden"> · {ownerName(f.owner)}</span>}
                        </span>
                      </div>
                    </div>
                  </div>
                </td>
                {showOwner && (
                  <td className={`${TD} hidden max-w-48 md:table-cell`}>
                    <UserLink user={f.owner} className="block truncate" />
                    {f.owner?.email && f.owner?.name && <div className="truncate text-xs text-muted">{f.owner.email}</div>}
                  </td>
                )}
                <td className={`${TD} hidden whitespace-nowrap text-right font-mono text-[13px] text-muted sm:table-cell`}>{formatBytes(f.size)}</td>
                <td className={`${TD} hidden whitespace-nowrap text-muted lg:table-cell`}>{formatDate(f.uploaded_at)}</td>
                <td className={`${TD} hidden text-right text-muted tabular-nums lg:table-cell`}>{f.download_count.toLocaleString()}</td>
                <td className={`${TD} hidden whitespace-nowrap text-muted xl:table-cell`} title={`${plural(f.link_count, 'link')} made`}>
                  {f.link_count ? (f.active_links ? `${f.active_links} active` : 'None active') : '—'}
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  <div className="flex items-center justify-end gap-0.5">
                    {ready && (
                      <button className="btn-icon" onClick={() => download(f)} disabled={Boolean(busy)}
                        title="Download (recorded in the activity log)" aria-label={`Download ${f.file_name}`}>
                        {busy === `dl-${f.file_id}` ? <Spinner /> : <Download className="h-4 w-4" />}
                      </button>
                    )}
                    {f.active_links > 0 && (
                      <button className="btn-icon" onClick={() => setConfirm({ kind: 'links', file: f })}
                        title="Turn off every link" aria-label={`Turn off every link to ${f.file_name}`}>
                        <Link2Off className="h-4 w-4" />
                      </button>
                    )}
                    <button className="btn-icon-danger" onClick={() => setConfirm({ kind: 'delete', file: f })}
                      title="Delete" aria-label={`Delete ${f.file_name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {confirm?.kind === 'delete' && (
        <ConfirmDialog danger title="Delete this file?" confirmLabel="Delete file" confirmIcon={Trash2}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await run('delete', () => adminApi.deleteFile(confirm.file.file_id, token), `Deleted ${confirm.file.file_name}.`);
            onChanged?.();
          }}>
          <span className="break-all font-medium text-fg">{confirm.file.file_name}</span> ({formatBytes(confirm.file.size)}),
          owned by {ownerName(confirm.file.owner)}, will be permanently deleted, and its links will stop working.
          The owner isn’t told. This can’t be undone.
        </ConfirmDialog>
      )}
      {confirm?.kind === 'links' && (
        <ConfirmDialog title="Turn off every link?" confirmLabel="Turn off links" confirmIcon={Link2Off}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await run('links', () => adminApi.revokeFileLinks(confirm.file.file_id, token), `Links to ${confirm.file.file_name} are turned off.`);
            onChanged?.();
          }}>
          The {plural(confirm.file.active_links, 'active link')} to <span className="break-all font-medium text-fg">{confirm.file.file_name}</span> will
          stop working. The file stays, and its owner can still make new links.
        </ConfirmDialog>
      )}
    </>
  );
}

function CopyButton({ text }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch (err) { toast.error(err); }
  };
  return (
    <button className="btn-icon h-7 w-7" onClick={copy} title="Copy link" aria-label="Copy link">
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function expiry(l) {
  if (!l.expires_at) return 'Never';
  const ms = l.expires_at * 1000;
  return ms < Date.now() ? `Ended ${formatRelative(ms)}` : formatDateTime(ms);
}

export function LinkTable({ links, token, onChanged, showOwner = true }) {
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState(null);

  return (
    <>
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-surface-2">
          <tr>
            <th className={TH}>Link</th>
            <th className={`${TH} hidden md:table-cell`}>File</th>
            <th className={TH}>Status</th>
            <th className={`${TH} hidden text-right sm:table-cell`}>Downloads</th>
            <th className={`${TH} hidden lg:table-cell`}>Made</th>
            <th className={`${TH} hidden xl:table-cell`}>Expires</th>
            <th className={TH}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {links.map((l) => {
            const ch = CHANNEL[l.channel] || CHANNEL.link;
            const st = LINK_STATUS[l.status] || LINK_STATUS.file_missing;
            return (
              <tr key={l.code} className="transition-colors hover:bg-surface-2">
                <td className={`${TD} w-full max-w-0`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted" title={ch.label}>
                      <ch.icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium" title={l.recipient || ch.label}>{l.recipient || ch.label}</div>
                      <div className="truncate text-xs text-muted">
                        <span className="font-mono">{l.code}</span>
                        <span className="md:hidden"> · {l.file?.file_name || 'deleted file'}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td className={`${TD} hidden max-w-56 md:table-cell`}>
                  <div className="truncate" title={l.file?.file_name}>{l.file?.file_name || <span className="text-muted">Deleted file</span>}</div>
                  {showOwner && <div className="truncate text-xs text-muted"><UserLink user={l.owner} /></div>}
                </td>
                <td className={TD}>
                  <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${st.className}`}>{st.label}</span>
                </td>
                <td className={`${TD} hidden whitespace-nowrap text-right text-muted tabular-nums sm:table-cell`}>
                  {l.max_downloads ? `${l.downloads} / ${l.max_downloads}` : l.downloads}
                </td>
                <td className={`${TD} hidden whitespace-nowrap text-muted lg:table-cell`} title={formatDateTime(l.created_at)}>{formatRelative(l.created_at)}</td>
                <td className={`${TD} hidden whitespace-nowrap text-muted xl:table-cell`}>{expiry(l)}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  <div className="flex items-center justify-end gap-1">
                    {l.status === 'active' && <CopyButton text={l.url} />}
                    {l.status === 'active' && (
                      <button className="btn-secondary h-8 px-2.5 text-xs" onClick={() => setConfirm(l)} disabled={Boolean(busy)}>
                        Turn off
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {confirm && (
        <ConfirmDialog title="Turn off this link?" confirmLabel="Turn off" confirmIcon={Link2Off}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await run('off', () => adminApi.revokeLink(confirm.code, token), 'Link turned off.');
            onChanged?.();
          }}>
          {confirm.recipient ? <>The link sent to <span className="font-medium text-fg">{confirm.recipient}</span></> : 'This link'} for{' '}
          <span className="break-all font-medium text-fg">{confirm.file?.file_name || 'a deleted file'}</span> will stop working right away.
        </ConfirmDialog>
      )}
    </>
  );
}
