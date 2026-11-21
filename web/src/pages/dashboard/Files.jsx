import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Upload, Search, RefreshCw, Download, Mail, Link2, Trash2, X, Send, QrCode, Copy, Check,
  AlertTriangle, CheckCircle2, AlertCircle, ArrowDownToLine, Link2Off, Clock, BarChart3, Pause, Play,
} from 'lucide-react';
import { Spinner, Modal } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { filesApi, LINK_EXPIRY, DEFAULT_EXPIRY, DOWNLOAD_LIMITS } from '../../api/filesApi';
import { formatBytes, formatDate, formatRelative, fileKind } from '../../lib/format';
import { KIND_ICON, KIND_LABEL, CHANNEL, LINK_STATUS as STATUS } from '../../lib/meta';

const SORTS = { date: 'Newest first', name: 'Name', size: 'Largest first' };

export default function Files() {
  const { session } = useAuth();
  const toast = useToast();
  const userId = session.userId;
  const idToken = session.tokens.id_token;
  // Long uploads outlive one token: they read the current one through a ref.
  const tokenRef = useRef(idToken);
  tokenRef.current = idToken;

  const [files, setFiles] = useState(null);
  const [usage, setUsage] = useState(null); // { used_bytes, quota_bytes (0 = unlimited) }
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('date');
  // {id, fileId, name, size, progress, resumable, status: uploading|paused|done|error}
  const [uploads, setUploads] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [shareFor, setShareFor] = useState(null);
  const [linkFor, setLinkFor] = useState(null); // { file, qr: bool }
  const [linksFor, setLinksFor] = useState(null);
  const [deleteFor, setDeleteFor] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const inputRef = useRef(null);
  const localFiles = useRef(new Map()); // upload id -> { file, controller } (for pause / resume)

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await filesApi.list(userId, idToken);
      setFiles(r.user_files || []);
      setUsage(r.usage || null);
    } catch (err) { toast.error(err); } finally { setLoading(false); }
  }, [userId, idToken, toast]);

  useEffect(() => { load(); }, [load]);

  const patchUpload = (id, patch) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const runUpload = async (id) => {
    const entry = localFiles.current.get(id);
    if (!entry) return;
    const controller = new AbortController();
    entry.controller = controller;
    patchUpload(id, { status: 'uploading' });
    try {
      await filesApi.upload({
        userId, file: entry.file, signal: controller.signal,
        getToken: () => tokenRef.current,
        onStarted: (fileId, resumable) => { patchUpload(id, { fileId, resumable }); load(); },
        onProgress: (p) => patchUpload(id, { progress: p }),
      });
      patchUpload(id, { progress: 100, status: 'done' });
      localFiles.current.delete(id);
      load();
    } catch (err) {
      if (err.aborted) { patchUpload(id, { status: 'paused' }); return; }
      patchUpload(id, { status: err.resumable ? 'paused' : 'error' });
      if (!err.resumable) localFiles.current.delete(id);
      if (err.status === 413) load();
      toast.error(err.resumable ? `${entry.file.name}: ${err.message} You can resume the upload.` : err);
    }
  };

  const pauseUpload = (id) => localFiles.current.get(id)?.controller?.abort();

  const handleFiles = (fileList) => {
    const list = [...fileList];
    // The server has the final say, but say "no room" before uploading anything.
    const quota = usage?.quota_bytes || 0;
    let room = quota ? quota - (usage.used_bytes || 0)
      - uploads.filter((u) => u.status === 'uploading').reduce((n, u) => n + u.size, 0) : Infinity;
    list.forEach((file) => {
      if (file.size > room) {
        toast.error(`Not enough storage for "${file.name}" (${formatBytes(file.size)}). `
          + `You have ${formatBytes(Math.max(0, room))} free.`);
        return;
      }
      room -= file.size;
      const id = Math.random().toString(36).slice(2);
      localFiles.current.set(id, { file });
      setUploads((u) => [...u, { id, name: file.name, size: file.size, progress: 0, status: 'uploading' }]);
      runUpload(id);
    });
  };

  // Drop files anywhere on the page. A ref keeps the window listeners pointed
  // at the latest handleFiles without re-binding on every render.
  const handleFilesRef = useRef(handleFiles);
  handleFilesRef.current = handleFiles;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const enter = (e) => { if (hasFiles(e)) { depth += 1; setDragging(true); } };
    const leave = (e) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); } };
    const over = (e) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault(); depth = 0; setDragging(false);
      handleFilesRef.current(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const download = async (f) => {
    try {
      const r = await filesApi.download(userId, f.file_id, idToken);
      const a = document.createElement('a');
      a.href = r.download_url; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { toast.error(err); }
  };

  const confirmDelete = async (f) => {
    await filesApi.remove(userId, f.file_id, idToken);
    setFiles((list) => list.filter((x) => x.file_id !== f.file_id));
    toast.success(`Deleted ${f.file_name}.`);
  };

  const visible = useMemo(() => (files || [])
    .filter((f) => f.file_name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => {
      if (sort === 'name') return a.file_name.localeCompare(b.file_name);
      if (sort === 'size') return (b.size || 0) - (a.size || 0);
      return (b.uploaded_at || '').localeCompare(a.uploaded_at || '');
    }), [files, query, sort]);

  const totalBytes = useMemo(() => (files || []).reduce((n, f) => n + (Number(f.size) || 0), 0), [files]);
  const openPicker = () => inputRef.current?.click();
  const openUpload = () => setUploadOpen(true);

  // Successful uploads leave the tray on their own a few seconds after the
  // last one finishes; failed and paused ones stay so they aren't missed.
  useEffect(() => {
    const busy = uploads.some((u) => u.status === 'uploading');
    if (busy || !uploads.some((u) => u.status === 'done')) return undefined;
    const t = setTimeout(() => setUploads((u) => u.filter((x) => x.status !== 'done')), 4000);
    return () => clearTimeout(t);
  }, [uploads]);

  // file id -> its upload in this tab (to show live progress in the file list)
  const liveUploads = useMemo(() => new Map(uploads.filter((u) => u.fileId).map((u) => [u.fileId, u])), [uploads]);

  return (
    <div>
      <input ref={inputRef} type="file" multiple className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; setUploadOpen(false); }} />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">All files</h1>
          <p className="mt-1 text-sm text-muted">
            {files
              ? <span className="tabular-nums">{files.length} {files.length === 1 ? 'file' : 'files'} · {formatBytes(totalBytes)} · </span>
              : null}
            You choose how long each link works and how many downloads it allows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-secondary w-9 px-0" disabled={loading} title="Refresh" aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={openUpload} className="btn-primary">
            <Upload className="h-4 w-4" /> Upload
          </button>
        </div>
      </div>

      {usage && <StorageBar usage={usage} />}

      {/* Toolbar */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input className="input h-9 pl-9" placeholder="Search files…" value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label="Search files" />
        </div>
        <select className="input h-9 w-auto pr-8" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort files">
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* File table */}
      <div className="panel mt-4 overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,1fr)_96px_128px_220px] items-center gap-4 border-b border-line bg-surface-2 px-4 py-2 text-xs font-medium text-muted sm:grid">
          <span>Name</span><span className="text-right">Size</span><span>Uploaded</span><span className="sr-only">Actions</span>
        </div>

        {!files && loading && <SkeletonRows />}

        {files && files.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
              <ArrowDownToLine className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-[15px] font-semibold">No files yet</h2>
            <p className="mt-1 max-w-xs text-sm text-muted">Drag files anywhere onto this page, or choose them from your computer.</p>
            <button onClick={openUpload} className="btn-primary mt-5"><Upload className="h-4 w-4" /> Upload files</button>
          </div>
        )}

        {files && files.length > 0 && visible.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-muted">No files match “{query}”.</div>
        )}

        {visible.length > 0 && (
          <ul className="divide-y divide-line">
            {visible.map((f) => (
              <FileRow key={f.file_id} f={f} live={liveUploads.get(f.file_id)}
                onDownload={() => download(f)} onShare={() => setShareFor(f)} onCopy={() => setLinkFor({ file: f, qr: false })}
                onQr={() => setLinkFor({ file: f, qr: true })} onLinks={() => setLinksFor(f)}
                onDelete={() => setDeleteFor(f)} />
            ))}
          </ul>
        )}
      </div>

      {dragging && !uploadOpen && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-canvas/80 p-6">
          <div className="grid h-full w-full place-items-center rounded-xl border-2 border-dashed border-accent bg-accent-soft">
            <div className="text-center">
              <ArrowDownToLine className="mx-auto h-8 w-8 text-accent" />
              <p className="mt-3 text-base font-semibold">Drop to upload</p>
              <p className="mt-1 text-sm text-muted">Drop an unfinished file again to resume it</p>
            </div>
          </div>
        </div>
      )}

      {uploads.length > 0 && (
        <UploadTray uploads={uploads} onPause={pauseUpload} onResume={runUpload}
          onClear={() => setUploads((u) => u.filter((x) => x.status === 'uploading'))} />
      )}
      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onChoose={openPicker}
          onFiles={(list) => { handleFiles(list); setUploadOpen(false); }} />
      )}

      {shareFor && <ShareModal file={shareFor} userId={userId} idToken={idToken} onClose={() => setShareFor(null)} />}
      {linkFor && <LinkModal file={linkFor.file} qr={linkFor.qr} userId={userId} idToken={idToken} onClose={() => setLinkFor(null)} />}
      {linksFor && <LinksModal file={linksFor} userId={userId} idToken={idToken} onClose={() => { setLinksFor(null); load(); }} />}
      {deleteFor && <DeleteModal file={deleteFor} onConfirm={confirmDelete} onClose={() => setDeleteFor(null)} />}
    </div>
  );
}

function StorageBar({ usage }) {
  const used = usage.used_bytes || 0;
  const quota = usage.quota_bytes || 0;
  if (!quota) {
    return <p className="mt-3 text-xs text-muted tabular-nums">{formatBytes(used)} used · no storage limit</p>;
  }
  const pct = Math.min(100, (used / quota) * 100);
  const tone = pct >= 95 ? 'bg-danger' : pct >= 80 ? 'bg-amber-500' : 'bg-accent';
  return (
    <div className="mt-4 max-w-md">
      <div className="flex items-baseline justify-between text-xs text-muted tabular-nums">
        <span><span className="font-medium text-fg">{formatBytes(used)}</span> of {formatBytes(quota)} used</span>
        <span>{formatBytes(Math.max(0, quota - used))} free</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar"
        aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(pct, used ? 1 : 0)}%` }} />
      </div>
    </div>
  );
}

function PendingStatus({ f, live }) {
  if (live?.status === 'uploading') {
    return <><Spinner className="h-3.5 w-3.5" /> Uploading… {live.progress}%</>;
  }
  if (live?.status === 'paused' || f.resumable) {
    return <span title="Upload the same file again to continue where it stopped"><Pause className="mr-1 inline h-3.5 w-3.5" />Paused · add the file again to resume</span>;
  }
  return <><Spinner className="h-3.5 w-3.5" /> Uploading…</>;
}

function FileRow({ f, live, onDownload, onShare, onCopy, onQr, onLinks, onDelete }) {
  const kind = fileKind(f.file_name, f.content_type);
  const Icon = KIND_ICON[kind];
  const pending = f.status && f.status !== 'READY';
  const downloads = f.download_count ? ` · ${f.download_count} ${f.download_count === 1 ? 'download' : 'downloads'}` : '';
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_96px_128px_220px]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" title={f.file_name}>{f.file_name}</div>
          <div className="mt-0.5 text-xs text-muted sm:hidden">
            {KIND_LABEL[kind]} · {formatBytes(f.size)}{f.uploaded_at ? ` · ${formatDate(f.uploaded_at)}` : ''}{downloads}
          </div>
          <div className="mt-0.5 hidden text-xs text-subtle sm:block">{KIND_LABEL[kind]}{downloads}</div>
        </div>
      </div>
      <div className="hidden text-right font-mono text-[13px] text-muted sm:block">{formatBytes(f.size)}</div>
      <div className="hidden text-sm text-muted sm:block">{formatDate(f.uploaded_at)}</div>

      <div className="col-span-2 flex items-center justify-end gap-0.5 sm:col-span-1">
        {pending ? (
          <>
            <span className="mr-auto flex items-center gap-1.5 text-xs text-muted sm:mr-1"><PendingStatus f={f} live={live} /></span>
            <button onClick={onDelete} className="btn-icon-danger" title="Delete" aria-label={`Delete ${f.file_name}`}>
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <button onClick={onDownload} className="btn-icon" title="Download" aria-label={`Download ${f.file_name}`}><Download className="h-4 w-4" /></button>
            <button onClick={onShare} className="btn-icon" title="Share by email" aria-label={`Share ${f.file_name} by email`}><Mail className="h-4 w-4" /></button>
            <button onClick={onCopy} className="btn-icon" title="Copy link" aria-label={`Copy link to ${f.file_name}`}><Link2 className="h-4 w-4" /></button>
            <button onClick={onQr} className="btn-icon" title="QR code" aria-label={`QR code for ${f.file_name}`}><QrCode className="h-4 w-4" /></button>
            <button onClick={onLinks} className="btn-icon" title="Links & downloads" aria-label={`Links and downloads for ${f.file_name}`}><BarChart3 className="h-4 w-4" /></button>
            <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
            <button onClick={onDelete} className="btn-icon-danger" title="Delete" aria-label={`Delete ${f.file_name}`}><Trash2 className="h-4 w-4" /></button>
          </>
        )}
      </div>
    </li>
  );
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-line" aria-label="Loading files">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="h-9 w-9 animate-pulse rounded-md bg-surface-2" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
            <div className="h-2.5 w-16 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function UploadModal({ onClose, onChoose, onFiles }) {
  const [over, setOver] = useState(false);
  const drop = (e) => {
    // Stop here so the page-wide drop handler doesn't upload the same files again.
    e.preventDefault(); e.stopPropagation(); setOver(false);
    if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
  };
  return (
    <Modal onClose={onClose} title="Upload files" icon={Upload} width="max-w-lg">
      <div
        onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
        onDrop={drop}
        onClick={onChoose}
        data-dropzone
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${
          over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2 hover:border-accent/60'}`}
      >
        <div className={`grid h-11 w-11 place-items-center rounded-lg border ${over ? 'border-accent/40 bg-surface text-accent' : 'border-line bg-surface text-muted'}`}>
          <ArrowDownToLine className="h-5 w-5" />
        </div>
        <p className="mt-4 text-[15px] font-semibold">{over ? 'Drop to upload' : 'Drag files here'}</p>
        <p className="mt-1 text-sm text-muted">or</p>
        <button type="button" autoFocus className="btn-secondary mt-3" onClick={(e) => { e.stopPropagation(); onChoose(); }}>
          Choose files
        </button>
        <p className="mt-5 text-xs text-muted">You can select several at once. Large files upload in parts and can be paused and resumed.</p>
      </div>
    </Modal>
  );
}

function UploadTray({ uploads, onClear, onPause, onResume }) {
  const active = uploads.filter((u) => u.status === 'uploading').length;
  const failed = uploads.filter((u) => u.status === 'error').length;
  const paused = uploads.filter((u) => u.status === 'paused').length;
  const title = active
    ? `Uploading ${active} ${active === 1 ? 'file' : 'files'}`
    : paused ? `${paused} ${paused === 1 ? 'upload' : 'uploads'} paused`
      : failed ? `${failed} ${failed === 1 ? 'upload' : 'uploads'} failed` : 'Uploads complete';
  return (
    <div className="panel fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))] overflow-hidden shadow-lg">
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5">
        <span className="text-sm font-medium">{title}</span>
        {!active && (
          <button onClick={onClear} className="btn-icon -mr-1.5 h-7 w-7" aria-label="Close uploads"><X className="h-4 w-4" /></button>
        )}
      </div>
      <ul className="max-h-64 divide-y divide-line overflow-y-auto">
        {uploads.map((u) => (
          <li key={u.id} className="px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              {u.status === 'done' && <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />}
              {u.status === 'error' && <AlertCircle className="h-4 w-4 shrink-0 text-danger" />}
              {u.status === 'uploading' && <Spinner className="h-4 w-4 shrink-0 text-muted" />}
              {u.status === 'paused' && <Pause className="h-4 w-4 shrink-0 text-muted" />}
              <span className="min-w-0 flex-1 truncate" title={u.name}>{u.name}</span>
              <span className={`shrink-0 font-mono text-xs ${u.status === 'error' ? 'text-danger' : 'text-muted'}`}>
                {u.status === 'error' ? 'Failed' : u.status === 'done' ? formatBytes(u.size) : `${u.progress}%`}
              </span>
              {u.status === 'uploading' && u.resumable && (
                <button onClick={() => onPause(u.id)} className="btn-icon -my-1 h-7 w-7" title="Pause" aria-label={`Pause ${u.name}`}>
                  <Pause className="h-3.5 w-3.5" />
                </button>
              )}
              {u.status === 'paused' && (
                <button onClick={() => onResume(u.id)} className="btn-icon -my-1 h-7 w-7" title="Resume" aria-label={`Resume ${u.name}`}>
                  <Play className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {(u.status === 'uploading' || u.status === 'paused') && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
                <div className={`h-full rounded-full transition-[width] ${u.status === 'paused' ? 'bg-line-strong' : 'bg-accent'}`}
                  style={{ width: `${u.progress}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const MAX_RECIPIENTS = 10; // the share API accepts at most 10 per request

function ShareModal({ file, userId, idToken, onClose }) {
  const toast = useToast();
  const [emails, setEmails] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY);
  const [limit, setLimit] = useState(null);

  const addEmail = (raw) => {
    const v = raw.trim().replace(/,$/, '');
    if (!v) return;
    if (!EMAIL_RE.test(v)) { toast.error(`"${v}" is not a valid email address.`); return; }
    if (!emails.includes(v)) setEmails((e) => [...e, v]);
    setDraft('');
  };

  const submit = async () => {
    const pending = draft.trim().replace(/,$/, '');
    if (pending && !EMAIL_RE.test(pending)) { toast.error(`"${pending}" is not a valid email address.`); return; }
    const valid = [...new Set(pending ? [...emails, pending] : emails)];
    if (valid.length === 0) { toast.error('Add at least one recipient.'); return; }
    if (valid.length > MAX_RECIPIENTS) { toast.error(`You can share with up to ${MAX_RECIPIENTS} people at a time.`); return; }
    setBusy(true);
    try {
      await filesApi.share(userId, file.file_id, idToken, valid, { expiresIn: expiry, maxDownloads: limit });
      toast.success(`Sent to ${valid.length} ${valid.length === 1 ? 'person' : 'people'}. ${expiryPhrase(expiry)}${limitPhrase(limit, valid.length > 1)}`);
      onClose();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Share by email" icon={Mail}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner /> : <><Send className="h-4 w-4" /> Send link</>}
        </button>
      </>}>
      <p className="truncate text-sm font-medium" title={file.file_name}>{file.file_name}</p>
      <p className="mt-1 text-sm text-muted">Each recipient gets an email with their own download link, so you can see who downloaded it.</p>

      <label className="label mt-5" htmlFor="share-emails">Recipients</label>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 py-1.5 focus-within:border-accent focus-within:ring-3 focus-within:ring-ring">
        {emails.map((e) => (
          <span key={e} className="inline-flex items-center gap-1 rounded bg-accent-soft py-0.5 pl-2 pr-1 text-xs font-medium text-accent">
            {e}
            <button onClick={() => setEmails((list) => list.filter((x) => x !== e))} className="rounded p-0.5 hover:bg-accent/15" aria-label={`Remove ${e}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input id="share-emails" autoFocus
          className="min-w-[140px] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-subtle"
          placeholder={emails.length ? 'Add another…' : 'name@example.com'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEmail(draft); }
            if (e.key === 'Backspace' && !draft && emails.length) setEmails((l) => l.slice(0, -1));
          }}
          onBlur={() => addEmail(draft)} />
      </div>
      <span className="hint">Press Enter or comma after each address.</span>

      <ExpiryPicker id="share-expiry" value={expiry} onChange={setExpiry} />
      <LimitPicker id="share-limit" value={limit} onChange={setLimit} perPerson />
    </Modal>
  );
}

// "The link works for 1 day." / "The link doesn't expire."
function expiryPhrase(expiry) {
  if (expiry === 'never') return 'The link doesn’t expire.';
  const label = LINK_EXPIRY.find((o) => o.value === expiry)?.label || '';
  return `The link works for ${label}.`;
}

// " Each link can be used 3 times."
function limitPhrase(limit, several) {
  if (!limit) return '';
  const times = limit === 1 ? 'once' : `${limit} times`;
  return several ? ` Each link can be used ${times}.` : ` It can be used ${times}.`;
}

function LimitPicker({ id, value, onChange, perPerson = false }) {
  return (
    <div className="mt-5">
      <label className="label" htmlFor={id}>Download limit</label>
      <select id={id} className="input h-9" value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        {DOWNLOAD_LIMITS.map((o) => <option key={o.label} value={o.value ?? ''}>{o.label}</option>)}
      </select>
      <span className="hint">
        {value
          ? `The link stops working after ${value === 1 ? '1 download' : `${value} downloads`}${perPerson ? ' (counted per recipient)' : ''}. People press a Download button first, so link previews don’t use it up.`
          : 'The link works any number of times until it expires.'}
      </span>
    </div>
  );
}

function formatExpiresAt(expiresAt) {
  if (!expiresAt) return 'Never expires';
  return `Expires ${new Date(expiresAt * 1000).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })}`;
}

function ExpiryPicker({ id, value, onChange }) {
  return (
    <div className="mt-5">
      <label className="label" htmlFor={id}>Link expires after</label>
      <select id={id} className="input h-9" value={value}
        onChange={(e) => onChange(e.target.value === 'never' ? 'never' : Number(e.target.value))}>
        {LINK_EXPIRY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {value === 'never' ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          Anyone with this link can download the file until you delete it or turn its links off.
        </p>
      ) : (
        <span className="hint">You can turn links off early from the file list.</span>
      )}
    </div>
  );
}

// Copy link (qr=false) and QR code (qr=true): pick an expiry, then create the link.
function LinkModal({ file, qr, userId, idToken, onClose }) {
  const toast = useToast();
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY);
  const [limit, setLimit] = useState(null);
  const [link, setLink] = useState(null); // { url, expiresAt, maxDownloads }
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) { toast.error(err); }
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await filesApi.createLink(userId, file.file_id, idToken,
        { expiresIn: expiry, maxDownloads: limit, channel: qr ? 'qr' : 'link' });
      setLink({ url: r.short_url, expiresAt: r.expires_at, maxDownloads: r.max_downloads });
      if (!qr) await copy(r.short_url);
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title={qr ? 'Scan to download' : 'Copy link'} icon={qr ? QrCode : Link2}
      width={qr ? 'max-w-sm' : 'max-w-md'}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Close</button>
        {link ? (
          <button className="btn-primary" onClick={() => copy(link.url)}>
            {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy link</>}
          </button>
        ) : (
          <button className="btn-primary" onClick={create} disabled={busy}>
            {busy ? <Spinner />
              : qr ? <><QrCode className="h-4 w-4" /> Create QR code</>
                : <><Link2 className="h-4 w-4" /> Create &amp; copy link</>}
          </button>
        )}
      </>}>
      <p className={`truncate text-sm font-medium ${qr ? 'text-center' : ''}`} title={file.file_name}>{file.file_name}</p>

      {qr && link && (
        <div className="mt-4 flex justify-center">
          {/* QR codes need dark-on-light to scan reliably, so the plate stays white in dark mode. */}
          <div className="grid h-[248px] w-[248px] place-items-center rounded-md border border-line bg-white p-3">
            <QRCodeSVG value={link.url} size={220} level="M" marginSize={1} />
          </div>
        </div>
      )}

      {!qr && link && (
        <input readOnly className="input mt-4 h-9 font-mono text-xs" value={link.url}
          onFocus={(e) => e.target.select()} aria-label="Download link" />
      )}

      {link ? (
        <p className={`mt-3 flex items-center gap-1.5 text-xs text-muted ${qr ? 'justify-center' : ''}`}>
          <Clock className="h-3.5 w-3.5" /> {formatExpiresAt(link.expiresAt)}
          {link.maxDownloads ? <><span aria-hidden="true">·</span> {link.maxDownloads === 1 ? '1 download' : `${link.maxDownloads} downloads`}</> : null}
          <span aria-hidden="true">·</span>
          <button className="underline underline-offset-2 hover:text-fg" onClick={() => setLink(null)}>New link</button>
        </p>
      ) : (
        <>
          <ExpiryPicker id="link-expiry" value={expiry} onChange={setExpiry} />
          <LimitPicker id="link-limit" value={limit} onChange={setLimit} />
        </>
      )}

      <p className={`mt-4 text-xs text-muted ${qr ? 'text-center' : ''}`}>
        Anyone with this link can download the file until it expires, you turn its links off, or you delete the file.
      </p>
    </Modal>
  );
}

// Every link shared for a file, with download stats; turn off one or all.
function LinksModal({ file, userId, idToken, onClose }) {
  const toast = useToast();
  const [data, setData] = useState(null); // { links, download_count }
  const [busy, setBusy] = useState(null); // code being turned off, or 'all'
  const [confirmAll, setConfirmAll] = useState(false);

  const refresh = useCallback(async () => {
    try { setData(await filesApi.links(userId, file.file_id, idToken)); } catch (err) { toast.error(err); }
  }, [userId, file.file_id, idToken, toast]);
  useEffect(() => { refresh(); }, [refresh]);

  const turnOff = async (code) => {
    setBusy(code);
    try {
      await filesApi.revokeLink(userId, file.file_id, code, idToken);
      await refresh();
    } catch (err) { toast.error(err); } finally { setBusy(null); }
  };

  const turnOffAll = async () => {
    setBusy('all');
    try {
      await filesApi.revokeLinks(userId, file.file_id, idToken);
      toast.success(`Links to ${file.file_name} are turned off.`);
      setConfirmAll(false);
      await refresh();
    } catch (err) { toast.error(err); } finally { setBusy(null); }
  };

  const links = data?.links || [];
  const active = links.filter((l) => l.status === 'active').length;

  return (
    <Modal onClose={busy ? () => {} : onClose} title="Links & downloads" icon={BarChart3} width="max-w-2xl"
      footer={confirmAll ? (
        <>
          <span className="mr-auto self-center text-sm text-danger">Turn off all {active} active {active === 1 ? 'link' : 'links'}?</span>
          <button className="btn-secondary" onClick={() => setConfirmAll(false)} disabled={busy === 'all'}>Cancel</button>
          <button className="btn-danger" onClick={turnOffAll} disabled={busy === 'all'}>
            {busy === 'all' ? <Spinner /> : <><Link2Off className="h-4 w-4" /> Turn off all</>}
          </button>
        </>
      ) : (
        <>
          {active > 0 && (
            <button className="btn-ghost mr-auto text-danger hover:text-danger" onClick={() => setConfirmAll(true)}>
              <Link2Off className="h-4 w-4" /> Turn off all links
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </>
      )}>
      <p className="truncate text-sm font-medium" title={file.file_name}>{file.file_name}</p>
      <p className="mt-1 text-sm text-muted tabular-nums">
        {data ? <>{data.download_count} {data.download_count === 1 ? 'download' : 'downloads'} through shared links · {active} active {active === 1 ? 'link' : 'links'}</> : 'Loading…'}
      </p>

      {!data && <div className="grid place-items-center py-10"><Spinner /></div>}
      {data && links.length === 0 && (
        <div className="mt-4 rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          No links yet. Share the file by email, copy a link, or make a QR code.
        </div>
      )}
      {links.length > 0 && (
        <ul className="mt-4 max-h-[50vh] divide-y divide-line overflow-y-auto rounded-md border border-line">
          {links.map((l) => {
            const ch = CHANNEL[l.channel] || CHANNEL.link;
            const st = STATUS[l.status] || STATUS.file_missing;
            return (
              <li key={l.code} className="flex items-center gap-3 px-3 py-2.5">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted" title={ch.label}>
                  <ch.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{l.recipient || ch.label}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${st.className}`}>{st.label}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted tabular-nums">
                    {l.max_downloads ? `${l.downloads} of ${l.max_downloads} downloads` : `${l.downloads} ${l.downloads === 1 ? 'download' : 'downloads'}`}
                    {l.last_downloaded_at ? ` · last ${formatRelative(l.last_downloaded_at * 1000)}` : ''}
                    {` · made ${formatRelative(l.created_at)}`}
                    {l.status === 'active' ? ` · ${l.expires_at ? formatExpiresAt(l.expires_at).toLowerCase() : 'never expires'}` : ''}
                  </div>
                </div>
                {l.status === 'active' && (
                  <button className="btn-secondary h-8 shrink-0 px-2.5 text-xs" onClick={() => turnOff(l.code)} disabled={Boolean(busy)}
                    aria-label={`Turn off link ${l.recipient ? `for ${l.recipient}` : ''}`}>
                    {busy === l.code ? <Spinner className="h-3.5 w-3.5" /> : 'Turn off'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

function DeleteModal({ file, onConfirm, onClose }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(file);
      onClose();
    } catch (err) { toast.error(err); setBusy(false); }
  };

  return (
    <Modal onClose={busy ? () => {} : onClose} width="max-w-sm"
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy} autoFocus>Cancel</button>
        <button className="btn-danger" onClick={confirm} disabled={busy}>
          {busy ? <Spinner /> : <><Trash2 className="h-4 w-4" /> Delete</>}
        </button>
      </>}>
      <div className="flex items-start gap-3.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Delete file?</h2>
          <p className="mt-1 text-sm text-muted">
            <span className="break-all font-medium text-fg">{file.file_name}</span> will be permanently deleted.
            Any links you've shared will stop working. This can't be undone.
          </p>
        </div>
      </div>
    </Modal>
  );
}
