import { useEffect, useRef, useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  UploadCloud, Search, RefreshCw, Download, Share2, Link2, Trash2, X, Send, QrCode, Copy, Check,
  AlertTriangle, Image, Video, Music, FileText, FileArchive, FileCode, File as FileIcon, Loader2,
} from 'lucide-react';
import { Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { filesApi } from '../../api/filesApi';
import { formatBytes, formatDate, fileKind } from '../../lib/format';

const KIND_ICON = {
  image: Image, video: Video, audio: Music, pdf: FileText,
  archive: FileArchive, code: FileCode, document: FileText, file: FileIcon,
};
const KIND_COLOR = {
  image: 'text-emerald-400 bg-emerald-500/10', video: 'text-fuchsia-400 bg-fuchsia-500/10',
  audio: 'text-amber-400 bg-amber-500/10', pdf: 'text-rose-400 bg-rose-500/10',
  archive: 'text-orange-400 bg-orange-500/10', code: 'text-sky-400 bg-sky-500/10',
  document: 'text-brand-400 bg-brand-500/10', file: 'text-slate-300 bg-white/5',
};

const MAX_UPLOAD_BYTES = 5 * 1024 ** 3; // S3 single-PUT limit (5 GiB)

export default function Files() {
  const { session } = useAuth();
  const toast = useToast();
  const userId = session.userId;
  const idToken = session.tokens.id_token;

  const [files, setFiles] = useState(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('date');
  const [uploads, setUploads] = useState([]); // active: {id, name, progress, error}
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

  const uploadOne = async (file) => {
    const tmp = Math.random().toString(36).slice(2);
    setUploads((u) => [...u, { id: tmp, name: file.name, progress: 0 }]);
    try {
      await filesApi.upload({
        userId, idToken, file,
        onProgress: (p) => setUploads((u) => u.map((x) => (x.id === tmp ? { ...x, progress: p } : x))),
      });
      setUploads((u) => u.filter((x) => x.id !== tmp));
      toast.success(`Uploaded ${file.name}`);
      load();
    } catch (err) {
      setUploads((u) => u.map((x) => (x.id === tmp ? { ...x, error: true } : x)));
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

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

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
      toast.success('Download link copied (valid 1 hour).');
    } catch (err) { toast.error(err); }
  };

  // Opens the confirmation popup; the actual delete runs from DeleteModal.
  const remove = (f) => setDeleteFor(f);

  const confirmDelete = async (f) => {
    await filesApi.remove(userId, f.file_id, idToken);
    setFiles((list) => list.filter((x) => x.file_id !== f.file_id));
    toast.success('File deleted.');
  };

  const visible = (files || [])
    .filter((f) => f.file_name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'name') return a.file_name.localeCompare(b.file_name);
      if (sort === 'size') return (b.size || 0) - (a.size || 0);
      return (b.uploaded_at || '').localeCompare(a.uploaded_at || '');
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">My Files</h1>
          <p className="mt-1 text-sm text-slate-400">Upload, download, and share with expiring links.</p>
        </div>
        <button onClick={load} className="btn-ghost text-sm" disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Refresh
        </button>
      </div>

      {/* Upload dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition ${
          dragging ? 'border-brand-500 bg-brand-500/10' : 'border-white/15 bg-white/[0.02] hover:border-brand-500/40 hover:bg-white/[0.04]'
        }`}
      >
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-400">
          <UploadCloud className="h-6 w-6" />
        </div>
        <p className="text-sm text-slate-200"><span className="font-semibold text-white">Drop files here</span> or click to browse</p>
        <p className="mt-1 text-xs text-slate-500">Uploaded straight to your private storage. Up to 5 GB per file.</p>
        <input ref={inputRef} type="file" multiple className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* Active uploads */}
      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((u) => (
            <div key={u.id} className="card p-3">
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 truncate text-slate-200">
                  <Loader2 className={`h-3.5 w-3.5 ${u.error ? 'text-rose-400' : 'animate-spin text-brand-400'}`} />
                  <span className="truncate">{u.name}</span>
                </span>
                <span className={u.error ? 'text-rose-400' : 'text-slate-400'}>{u.error ? 'Failed' : `${u.progress}%`}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full ${u.error ? 'bg-rose-500' : 'bg-brand-500'} transition-all`} style={{ width: `${u.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className="input pl-10" placeholder="Search files…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="date">Newest</option>
          <option value="name">Name</option>
          <option value="size">Largest</option>
        </select>
      </div>

      {/* Library */}
      {loading && !files && <div className="flex items-center gap-2 text-sm text-slate-400"><Spinner /> Loading files…</div>}

      {files && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center">
          <p className="text-sm text-slate-400">{query ? 'No files match your search.' : 'No files yet — drop one above to get started.'}</p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((f) => {
            const kind = fileKind(f.file_name, f.content_type);
            const Icon = KIND_ICON[kind];
            const uploading = f.status && f.status !== 'READY';
            return (
              <div key={f.file_id} className="card group flex flex-col p-4 transition hover:border-brand-500/30 hover:bg-white/[0.05]">
                <div className="flex items-start gap-3">
                  <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${KIND_COLOR[kind]}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white" title={f.file_name}>{f.file_name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {formatBytes(f.size)}{f.uploaded_at ? ` · ${formatDate(f.uploaded_at)}` : ''}
                    </div>
                  </div>
                </div>

                {uploading ? (
                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/5 pt-3 text-xs text-amber-400">
                    <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</span>
                    <button onClick={() => remove(f)} className="rounded-lg px-2 py-1 text-rose-400 hover:bg-rose-500/10" title="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center gap-1 border-t border-white/5 pt-3">
                    <button onClick={() => download(f)} className="flex-1 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white" title="Download">
                      <Download className="mx-auto h-4 w-4" />
                    </button>
                    <button onClick={() => setShareFor(f)} className="flex-1 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white" title="Share by email">
                      <Share2 className="mx-auto h-4 w-4" />
                    </button>
                    <button onClick={() => copyLink(f)} className="flex-1 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white" title="Copy link">
                      <Link2 className="mx-auto h-4 w-4" />
                    </button>
                    <button onClick={() => setQrFor(f)} className="flex-1 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white" title="QR code">
                      <QrCode className="mx-auto h-4 w-4" />
                    </button>
                    <button onClick={() => remove(f)} className="flex-1 rounded-lg px-2 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10" title="Delete">
                      <Trash2 className="mx-auto h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {shareFor && (
        <ShareModal file={shareFor} userId={userId} idToken={idToken} onClose={() => setShareFor(null)} />
      )}
      {qrFor && (
        <QrModal file={qrFor} userId={userId} idToken={idToken} onClose={() => setQrFor(null)} />
      )}
      {deleteFor && (
        <DeleteModal file={deleteFor} onConfirm={confirmDelete} onClose={() => setDeleteFor(null)} />
      )}
    </div>
  );
}

// Shared popup shell: dimmed backdrop, click-outside and Escape to close.
function Modal({ onClose, children, className = 'max-w-md' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" className={`card w-full p-6 ${className}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
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
    <Modal onClose={onClose} className="max-w-sm">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-brand-400" />
          <h3 className="font-semibold text-white">Scan to download</h3>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
      <p className="mb-4 truncate text-sm text-slate-400" title={file.file_name}>{file.file_name}</p>

      <div className="flex justify-center">
        <div className="grid h-[288px] w-[288px] place-items-center rounded-2xl bg-white p-3">
          {url && <QRCodeSVG value={url} size={240} level="M" marginSize={1} />}
          {!url && !error && <Spinner className="text-slate-500" />}
          {error && <p className="px-4 text-center text-sm text-rose-600">{error}</p>}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        Anyone who scans this can download the file. The link expires in <span className="text-slate-200">1 hour</span>.
      </p>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Close</button>
        <button className="btn-primary" onClick={copy} disabled={!url}>
          {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy link</>}
        </button>
      </div>
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
    <Modal onClose={busy ? () => {} : onClose} className="max-w-sm">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-400">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-white">Delete file?</h3>
          <p className="mt-1 text-sm text-slate-400">
            <span className="break-all font-medium text-slate-200">{file.file_name}</span> will be permanently
            deleted. Any links you've shared will stop working. This can't be undone.
          </p>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose} disabled={busy} autoFocus>Cancel</button>
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60"
          onClick={confirm} disabled={busy}
        >
          {busy ? <Spinner /> : <><Trash2 className="h-4 w-4" /> Delete</>}
        </button>
      </div>
    </Modal>
  );
}

function ShareModal({ file, userId, idToken, onClose }) {
  const toast = useToast();
  const [emails, setEmails] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const addEmail = (raw) => {
    const v = raw.trim().replace(/,$/, '');
    if (!v) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return toast.error(`"${v}" is not a valid email.`);
    if (!emails.includes(v)) setEmails((e) => [...e, v]);
    setDraft('');
  };

  const submit = async () => {
    const all = draft ? [...emails, draft.trim()] : emails;
    const valid = all.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (valid.length === 0) return toast.error('Add at least one recipient.');
    setBusy(true);
    try {
      await filesApi.share(userId, file.file_id, idToken, valid);
      toast.success(`Shared with ${valid.length} recipient${valid.length > 1 ? 's' : ''}.`);
      onClose();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-brand-400" />
            <h3 className="font-semibold text-white">Share file</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 truncate text-sm text-slate-400" title={file.file_name}>
          Recipients get an email with a download link valid for <span className="text-slate-200">1 hour</span>.
        </p>

        <span className="label">Recipient emails</span>
        <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-slate-900/60 p-2">
          {emails.map((e) => (
            <span key={e} className="inline-flex items-center gap-1 rounded-lg bg-brand-500/15 px-2 py-1 text-xs text-brand-200">
              {e}
              <button onClick={() => setEmails((list) => list.filter((x) => x !== e))} className="hover:text-white"><X className="h-3 w-3" /></button>
            </span>
          ))}
          <input
            className="min-w-[120px] flex-1 bg-transparent px-1 py-1 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            placeholder="name@example.com"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEmail(draft); } }}
            onBlur={() => addEmail(draft)}
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <><Send className="h-4 w-4" /> Send</>}
          </button>
        </div>
      </div>
    </div>
  );
}
