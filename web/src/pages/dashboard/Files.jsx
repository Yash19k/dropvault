import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Upload, Search, RefreshCw, Download, Mail, Link2, Trash2, X, Send, QrCode, Copy, Check,
  AlertTriangle, Image, Video, Music, FileText, FileArchive, FileCode, File as FileIcon,
  CheckCircle2, AlertCircle, ArrowDownToLine,
} from 'lucide-react';
import { Spinner, Modal } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { filesApi } from '../../api/filesApi';
import { formatBytes, formatDate, fileKind } from '../../lib/format';

const KIND_ICON = {
  image: Image, video: Video, audio: Music, pdf: FileText,
  archive: FileArchive, code: FileCode, document: FileText, file: FileIcon,
};
const KIND_LABEL = {
  image: 'Image', video: 'Video', audio: 'Audio', pdf: 'PDF',
  archive: 'Archive', code: 'Code', document: 'Document', file: 'File',
};

const MAX_UPLOAD_BYTES = 5 * 1024 ** 3; // S3 single-PUT limit (5 GiB)
const SORTS = { date: 'Newest first', name: 'Name', size: 'Largest first' };

export default function Files() {
  const { session } = useAuth();
  const toast = useToast();
  const userId = session.userId;
  const idToken = session.tokens.id_token;

  const [files, setFiles] = useState(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('date');
  const [uploads, setUploads] = useState([]); // {id, name, size, progress, status: uploading|done|error}
  const [dragging, setDragging] = useState(false);
  const [shareFor, setShareFor] = useState(null);
  const [qrFor, setQrFor] = useState(null);
  const [deleteFor, setDeleteFor] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await filesApi.list(userId, idToken);
      setFiles(r.user_files || []);
    } catch (err) { toast.error(err); } finally { setLoading(false); }
  }, [userId, idToken, toast]);

  useEffect(() => { load(); }, [load]);

  const patchUpload = (id, patch) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const uploadOne = async (file) => {
    const id = Math.random().toString(36).slice(2);
    setUploads((u) => [...u, { id, name: file.name, size: file.size, progress: 0, status: 'uploading' }]);
    try {
      await filesApi.upload({
        userId, idToken, file,
        onProgress: (p) => patchUpload(id, { progress: p }),
      });
      patchUpload(id, { progress: 100, status: 'done' });
      load();
    } catch (err) {
      patchUpload(id, { status: 'error' });
      toast.error(err);
    }
  };

  const handleFiles = (fileList) => {
    [...fileList].forEach((file) => {
      // S3 accepts at most 5 GB in a single upload; stop early with a clear message.
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`"${file.name}" is ${formatBytes(file.size)}. Files can be up to 5 GB.`);
        return;
      }
      uploadOne(file);
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

  const copyLink = async (f) => {
    try {
      const r = await filesApi.download(userId, f.file_id, idToken);
      await navigator.clipboard.writeText(r.download_url);
      toast.success('Link copied. It works for 1 hour.');
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

  return (
    <div>
      <input ref={inputRef} type="file" multiple className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">All files</h1>
          <p className="mt-1 text-sm text-muted">
            {files
              ? <span className="tabular-nums">{files.length} {files.length === 1 ? 'file' : 'files'} · {formatBytes(totalBytes)} · </span>
              : null}
            Up to 5 GB per file. Links expire after 1 hour.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-secondary w-9 px-0" disabled={loading} title="Refresh" aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={openPicker} className="btn-primary">
            <Upload className="h-4 w-4" /> Upload
          </button>
        </div>
      </div>

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
        <div className="hidden grid-cols-[minmax(0,1fr)_96px_128px_188px] items-center gap-4 border-b border-line bg-surface-2 px-4 py-2 text-xs font-medium text-muted sm:grid">
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
            <button onClick={openPicker} className="btn-primary mt-5"><Upload className="h-4 w-4" /> Upload files</button>
          </div>
        )}

        {files && files.length > 0 && visible.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-muted">No files match “{query}”.</div>
        )}

        {visible.length > 0 && (
          <ul className="divide-y divide-line">
            {visible.map((f) => (
              <FileRow key={f.file_id} f={f}
                onDownload={() => download(f)} onShare={() => setShareFor(f)} onCopy={() => copyLink(f)}
                onQr={() => setQrFor(f)} onDelete={() => setDeleteFor(f)} />
            ))}
          </ul>
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-canvas/80 p-6">
          <div className="grid h-full w-full place-items-center rounded-xl border-2 border-dashed border-accent bg-accent-soft">
            <div className="text-center">
              <ArrowDownToLine className="mx-auto h-8 w-8 text-accent" />
              <p className="mt-3 text-base font-semibold">Drop to upload</p>
              <p className="mt-1 text-sm text-muted">Up to 5 GB per file</p>
            </div>
          </div>
        </div>
      )}

      {uploads.length > 0 && <UploadTray uploads={uploads} onClear={() => setUploads((u) => u.filter((x) => x.status === 'uploading'))} />}

      {shareFor && <ShareModal file={shareFor} userId={userId} idToken={idToken} onClose={() => setShareFor(null)} />}
      {qrFor && <QrModal file={qrFor} userId={userId} idToken={idToken} onClose={() => setQrFor(null)} />}
      {deleteFor && <DeleteModal file={deleteFor} onConfirm={confirmDelete} onClose={() => setDeleteFor(null)} />}
    </div>
  );
}

function FileRow({ f, onDownload, onShare, onCopy, onQr, onDelete }) {
  const kind = fileKind(f.file_name, f.content_type);
  const Icon = KIND_ICON[kind];
  const pending = f.status && f.status !== 'READY';
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_96px_128px_188px]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" title={f.file_name}>{f.file_name}</div>
          <div className="mt-0.5 text-xs text-muted sm:hidden">
            {KIND_LABEL[kind]} · {formatBytes(f.size)}{f.uploaded_at ? ` · ${formatDate(f.uploaded_at)}` : ''}
          </div>
          <div className="mt-0.5 hidden text-xs text-subtle sm:block">{KIND_LABEL[kind]}</div>
        </div>
      </div>
      <div className="hidden text-right font-mono text-[13px] text-muted sm:block">{formatBytes(f.size)}</div>
      <div className="hidden text-sm text-muted sm:block">{formatDate(f.uploaded_at)}</div>

      <div className="col-span-2 flex items-center justify-end gap-0.5 sm:col-span-1">
        {pending ? (
          <>
            <span className="mr-auto flex items-center gap-1.5 text-xs text-muted sm:mr-1"><Spinner className="h-3.5 w-3.5" /> Uploading…</span>
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

function UploadTray({ uploads, onClear }) {
  const active = uploads.filter((u) => u.status === 'uploading').length;
  const failed = uploads.filter((u) => u.status === 'error').length;
  const title = active
    ? `Uploading ${active} ${active === 1 ? 'file' : 'files'}`
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
              <span className="min-w-0 flex-1 truncate" title={u.name}>{u.name}</span>
              <span className={`shrink-0 font-mono text-xs ${u.status === 'error' ? 'text-danger' : 'text-muted'}`}>
                {u.status === 'error' ? 'Failed' : u.status === 'done' ? formatBytes(u.size) : `${u.progress}%`}
              </span>
            </div>
            {u.status === 'uploading' && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${u.progress}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ShareModal({ file, userId, idToken, onClose }) {
  const toast = useToast();
  const [emails, setEmails] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const addEmail = (raw) => {
    const v = raw.trim().replace(/,$/, '');
    if (!v) return;
    if (!EMAIL_RE.test(v)) { toast.error(`"${v}" is not a valid email address.`); return; }
    if (!emails.includes(v)) setEmails((e) => [...e, v]);
    setDraft('');
  };

  const submit = async () => {
    const all = draft.trim() ? [...emails, draft.trim()] : emails;
    const valid = all.filter((e) => EMAIL_RE.test(e));
    if (valid.length === 0) { toast.error('Add at least one recipient.'); return; }
    setBusy(true);
    try {
      await filesApi.share(userId, file.file_id, idToken, valid);
      toast.success(`Sent to ${valid.length} ${valid.length === 1 ? 'person' : 'people'}.`);
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
      <p className="mt-1 text-sm text-muted">Each recipient gets an email with a download link that works for 1 hour.</p>

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
    </Modal>
  );
}

function QrModal({ file, userId, idToken, onClose }) {
  const toast = useToast();
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    filesApi.qrLink(userId, file.file_id, idToken)
      .then((r) => { if (alive) setUrl(r.short_url); })
      .catch((err) => { if (alive) setError(err.message || 'Could not create a link.'); });
    return () => { alive = false; };
  }, [file.file_id, userId, idToken]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) { toast.error(err); }
  };

  return (
    <Modal onClose={onClose} title="Scan to download" icon={QrCode} width="max-w-sm"
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Close</button>
        <button className="btn-primary" onClick={copy} disabled={!url}>
          {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy link</>}
        </button>
      </>}>
      <p className="truncate text-center text-sm font-medium" title={file.file_name}>{file.file_name}</p>
      <div className="mt-4 flex justify-center">
        {/* QR codes need dark-on-light to scan reliably, so the plate stays white in dark mode. */}
        <div className="grid h-[248px] w-[248px] place-items-center rounded-md border border-line bg-white p-3">
          {url && <QRCodeSVG value={url} size={220} level="M" marginSize={1} />}
          {!url && !error && <Spinner className="text-neutral-400" />}
          {error && <p className="px-4 text-center text-sm text-red-700">{error}</p>}
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted">
        Anyone who scans this can download the file. The link expires in 1 hour, or as soon as you delete the file.
      </p>
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
