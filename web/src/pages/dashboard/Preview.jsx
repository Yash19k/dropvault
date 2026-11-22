// In-app file preview: images (zoom, rotate), video and audio (the browser's
// full player), PDFs, Markdown (rendered, with an outline of its headings),
// CSV as a table, JSON pretty-printed, and any text or code file with line
// numbers. Media and PDFs stream straight from S3 through a short-lived
// "inline" URL; text is fetched (first 2 MB) and shown here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  X, Download, ExternalLink, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, Scan,
  FileQuestion, ListTree, Code, Eye, Table, Braces, WrapText, AlertCircle,
} from 'lucide-react';
import { Spinner } from '../../components/ui';
import { filesApi } from '../../api/filesApi';
import { formatBytes } from '../../lib/format';
import { KIND_ICON } from '../../lib/meta';

const TEXT_LIMIT = 2 * 1024 * 1024;   // bytes of a text file we show
const SNIFF_LIMIT = 5 * 1024 * 1024;  // unknown files up to this size are checked for text

const TEXT_EXT = new Set([
  'txt', 'text', 'log', 'md', 'markdown', 'mdx', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'geojson',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'xml', 'html', 'htm', 'svg',
  'css', 'scss', 'sass', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'py', 'rb',
  'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'pl', 'lua',
  'r', 'sql', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'dockerfile', 'makefile', 'gradle',
  'tf', 'tfvars', 'hcl', 'graphql', 'gql', 'proto', 'srt', 'vtt', 'gitignore', 'editorconfig', 'rst', 'tex',
]);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);
const VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'weba']);

const extOf = (name = '') => {
  const base = name.toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1) : base;   // "Dockerfile" -> "dockerfile"
};

// How a file is previewed: image | video | audio | pdf | markdown | csv | json | text | sniff | none
export function previewMode(file) {
  const ext = extOf(file.file_name);
  const ct = (file.content_type || '').toLowerCase();
  if (ext === 'svg') return 'image';
  if (ct.startsWith('image/') || IMAGE_EXT.has(ext)) return 'image';
  if (ct.startsWith('video/') || VIDEO_EXT.has(ext)) return 'video';
  if (ct.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio';
  if (ct === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['md', 'markdown', 'mdx'].includes(ext) || ct === 'text/markdown') return 'markdown';
  if (['csv', 'tsv'].includes(ext) || ct === 'text/csv') return 'csv';
  if (['json', 'geojson'].includes(ext) || ct === 'application/json') return 'json';
  if (TEXT_EXT.has(ext) || ct.startsWith('text/') || /(json|xml|javascript|yaml|x-sh)/.test(ct)) return 'text';
  if (Number(file.size) <= SNIFF_LIMIT) return 'sniff';
  return 'none';
}

export default function Preview({ files, index, userId, idToken, onIndex, onDownload, onClose }) {
  const file = files[index];
  const mode = previewMode(file);
  const Icon = KIND_ICON[kindFor(mode)] || KIND_ICON.file;
  const [state, setState] = useState({ status: 'loading' }); // {status, url, contentType} | {status:'error', error}
  const ref = useRef(null);
  const cache = useRef(new Map());   // file id -> preview URL (valid for hours)

  const hasPrev = index > 0;
  const hasNext = index < files.length - 1;

  useEffect(() => {
    let live = true;
    const cached = cache.current.get(file.file_id);
    if (cached) { setState({ status: 'ready', ...cached }); return undefined; }
    setState({ status: 'loading' });
    filesApi.preview(userId, file.file_id, idToken)
      .then((r) => {
        const value = { url: r.preview_url, contentType: r.content_type };
        cache.current.set(file.file_id, value);
        if (live) setState({ status: 'ready', ...value });
      })
      .catch((error) => { if (live) setState({ status: 'error', error }); });
    return () => { live = false; };
  }, [file.file_id, userId, idToken]);

  // Escape closes; arrow keys move between files (not while a player, field or
  // the PDF viewer has focus, where arrows seek or scroll).
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.target.closest?.('video, audio, input, textarea, select, iframe, [data-keys]')) return;
    if (e.key === 'ArrowLeft' && hasPrev) { e.preventDefault(); onIndex(index - 1); }
    if (e.key === 'ArrowRight' && hasNext) { e.preventDefault(); onIndex(index + 1); }
  };
  useEffect(() => {
    const onKey = (e) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
    };
  }, []);

  const canOpen = state.status === 'ready' && ['image', 'video', 'audio', 'pdf'].includes(mode);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 p-0 sm:p-4 dark:bg-black/70" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={`Preview of ${file.file_name}`} tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="panel mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-none shadow-lg outline-none sm:rounded-lg">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-3 py-2.5 sm:px-4">
          <div className="hidden h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted sm:grid">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold" title={file.file_name}>{file.file_name}</h2>
            <p className="truncate text-xs text-muted tabular-nums">
              {formatBytes(file.size)}{file.content_type ? ` · ${file.content_type}` : ''}
              {files.length > 1 ? ` · ${index + 1} of ${files.length}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {files.length > 1 && (
              <>
                <button className="btn-icon" onClick={() => onIndex(index - 1)} disabled={!hasPrev}
                  title="Previous file (Left arrow)" aria-label="Previous file"><ChevronLeft className="h-4 w-4" /></button>
                <button className="btn-icon" onClick={() => onIndex(index + 1)} disabled={!hasNext}
                  title="Next file (Right arrow)" aria-label="Next file"><ChevronRight className="h-4 w-4" /></button>
                <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
              </>
            )}
            {canOpen && (
              <a className="btn-icon" href={state.url} target="_blank" rel="noopener noreferrer"
                title="Open in a new tab" aria-label="Open in a new tab"><ExternalLink className="h-4 w-4" /></a>
            )}
            <button className="btn-icon" onClick={() => onDownload(file)} title="Download" aria-label={`Download ${file.file_name}`}>
              <Download className="h-4 w-4" />
            </button>
            <button className="btn-icon" onClick={onClose} title="Close (Esc)" aria-label="Close preview"><X className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="relative min-h-0 flex-1 bg-surface-2">
          {state.status === 'loading' && <Centered><Spinner className="h-5 w-5 text-muted" /></Centered>}
          {state.status === 'error' && (
            <Message icon={AlertCircle} title="Couldn’t load the preview" text={state.error?.message}
              action={<button className="btn-secondary" onClick={() => onDownload(file)}><Download className="h-4 w-4" /> Download instead</button>} />
          )}
          {state.status === 'ready' && (
            <Body key={file.file_id} mode={mode} file={file} url={state.url} onDownload={() => onDownload(file)} />
          )}
        </div>
      </div>
    </div>
  );
}

function kindFor(mode) {
  if (['markdown', 'csv', 'text', 'sniff'].includes(mode)) return 'document';
  if (mode === 'json') return 'code';
  if (mode === 'none') return 'file';
  return mode;
}

function Body({ mode, file, url, onDownload }) {
  const unsupported = (text) => (
    <Message icon={FileQuestion} title="This file can’t be previewed here" text={text}
      action={<button className="btn-primary" onClick={onDownload}><Download className="h-4 w-4" /> Download</button>} />
  );
  switch (mode) {
    case 'image': return <ImageView url={url} name={file.file_name} fallback={unsupported('Your browser can’t display this image format.')} />;
    case 'video': return <VideoView url={url} fallback={unsupported('Your browser can’t play this video format. Download it and open it in a video player.')} />;
    case 'audio': return <AudioView url={url} name={file.file_name} fallback={unsupported('Your browser can’t play this audio format.')} />;
    case 'pdf': return <iframe src={url} title={file.file_name} className="h-full w-full border-0 bg-surface" />;
    case 'none': return unsupported(`There’s no preview for ${extOf(file.file_name).toUpperCase() || 'this'} files yet. You can still download it.`);
    default: return <TextView mode={mode} file={file} url={url} unsupported={unsupported} />;
  }
}

// --- Image -------------------------------------------------------------------
const ZOOMS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

function ImageView({ url, name, fallback }) {
  const [zoom, setZoom] = useState(null);   // null = fit to the window
  const [rotate, setRotate] = useState(0);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState(null);
  const [fitScale, setFitScale] = useState(null);   // scale of the fitted image, for the zoom label
  const img = useRef(null);
  if (failed) return fallback;

  const current = () => zoom ?? (img.current ? img.current.clientWidth / (img.current.naturalWidth || 1) : 1);
  const step = (dir) => {
    const z = current();
    const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.001) : [...ZOOMS].reverse().find((v) => v < z - 0.001);
    if (next) setZoom(next);
  };
  const fitted = zoom === null;
  const measure = () => { if (img.current?.naturalWidth) setFitScale(img.current.clientWidth / img.current.naturalWidth); };
  const sideways = rotate % 180 !== 0;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto"
        onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); step(e.deltaY < 0 ? 1 : -1); } }}
        onDoubleClick={() => setZoom(fitted ? 1 : null)}>
        <div className={`flex min-h-full min-w-full items-center justify-center p-4 ${fitted ? 'h-full' : 'w-max'}`}>
          <img ref={img} src={url} alt={name} draggable={false}
            onLoad={(e) => { setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); measure(); }}
            onError={() => setFailed(true)}
            className={`checker select-none shadow-sm ${fitted ? 'max-h-full max-w-full object-contain' : 'max-w-none'}`}
            style={{
              transform: rotate ? `rotate(${rotate}deg)` : undefined,
              width: !fitted && natural ? natural.w * zoom : undefined,
              ...(fitted && sideways ? { maxWidth: 'min(100%, 80vh)', maxHeight: '80vw' } : {}),
            }} />
        </div>
      </div>
      <Toolbar>
        <button className="btn-icon h-8 w-8" onClick={() => step(-1)} title="Zoom out" aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></button>
        <span className="w-12 text-center font-mono text-xs text-muted tabular-nums">{fitted ? (fitScale ? `${Math.round(fitScale * 100)}%` : '') : `${Math.round(zoom * 100)}%`}</span>
        <button className="btn-icon h-8 w-8" onClick={() => step(1)} title="Zoom in (Ctrl + scroll)" aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></button>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
        <button className={`btn-ghost h-8 px-2 text-xs ${fitted ? 'text-fg' : ''}`} onClick={() => setZoom(null)} title="Fit to window">
          <Scan className="h-3.5 w-3.5" /> Fit
        </button>
        <button className={`btn-ghost h-8 px-2 text-xs ${zoom === 1 ? 'text-fg' : ''}`} onClick={() => setZoom(1)} title="Actual size">1:1</button>
        <button className="btn-icon h-8 w-8" onClick={() => setRotate((r) => (r + 90) % 360)} title="Rotate" aria-label="Rotate 90 degrees">
          <RotateCw className="h-4 w-4" />
        </button>
        {natural && <span className="ml-auto hidden font-mono text-xs text-muted tabular-nums sm:inline">{natural.w} × {natural.h}</span>}
      </Toolbar>
    </div>
  );
}

// --- Video / audio -------------------------------------------------------------
// The browser's own player: play/pause, seek, volume, speed, captions,
// picture-in-picture and full screen.
function VideoView({ url, fallback }) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback;
  return (
    <div className="flex h-full items-center justify-center bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video src={url} controls autoPlay playsInline preload="metadata" onError={() => setFailed(true)}
        className="max-h-full max-w-full" />
    </div>
  );
}

function AudioView({ url, name, fallback }) {
  const [failed, setFailed] = useState(false);
  const Icon = KIND_ICON.audio;
  if (failed) return fallback;
  return (
    <Centered>
      <div className="panel w-[min(480px,calc(100%-2rem))] p-6 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
          <Icon className="h-6 w-6" />
        </div>
        <p className="mt-4 truncate text-sm font-medium" title={name}>{name}</p>
        <audio src={url} controls autoPlay preload="metadata" onError={() => setFailed(true)} className="mt-5 w-full" />
      </div>
    </Centered>
  );
}

// --- Text, code, Markdown, CSV, JSON --------------------------------------------
function looksBinary(bytes) {
  const n = Math.min(bytes.length, 8000);
  let odd = 0;
  for (let i = 0; i < n; i += 1) {
    const b = bytes[i];
    if (b === 0) return true;
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) odd += 1;
  }
  return n > 0 && odd / n > 0.1;
}

function TextView({ mode, file, url, unsupported }) {
  const [data, setData] = useState(null); // { text, truncated } | { binary } | { error }
  useEffect(() => {
    let live = true;
    const size = Number(file.size) || 0;
    const truncated = size > TEXT_LIMIT;
    fetch(url, truncated ? { headers: { Range: `bytes=0-${TEXT_LIMIT - 1}` } } : undefined)
      .then((r) => { if (!r.ok) throw new Error(`Storage answered ${r.status}`); return r.arrayBuffer(); })
      .then((buf) => {
        if (!live) return;
        const bytes = new Uint8Array(buf);
        if (mode === 'sniff' && looksBinary(bytes)) { setData({ binary: true }); return; }
        setData({ text: new TextDecoder('utf-8').decode(bytes), truncated });
      })
      .catch((error) => { if (live) setData({ error }); });
    return () => { live = false; };
  }, [url, mode, file.size]);

  if (!data) return <Centered><Spinner className="h-5 w-5 text-muted" /></Centered>;
  if (data.error) return unsupported(`The file couldn’t be read: ${data.error.message}`);
  if (data.binary) return unsupported('This looks like a binary file, so there’s nothing readable to show.');

  const note = data.truncated
    ? `Showing the first ${formatBytes(TEXT_LIMIT)} of ${formatBytes(file.size)}. Download the file to see all of it.`
    : null;
  if (mode === 'markdown') return <MarkdownView text={data.text} note={note} />;
  if (mode === 'csv') return <CsvView text={data.text} tab={extOf(file.file_name) === 'tsv'} note={note} />;
  if (mode === 'json') return <JsonView text={data.text} note={note} />;
  return <SourceView text={data.text} note={note} />;
}

function Tabs({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5" role="tablist">
      {options.map(({ value: v, label, icon: I }) => (
        <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)}
          className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors ${
            value === v ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'}`}>
          <I className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

function SourceView({ text, note, wrapDefault = false }) {
  const [wrap, setWrap] = useState(wrapDefault);
  const lines = useMemo(() => text.replace(/\r\n?/g, '\n').split('\n'), [text]);
  const width = String(lines.length).length;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto bg-surface" data-keys>
        <pre className={`py-3 font-mono text-[12.5px] leading-[1.6] text-fg ${wrap ? 'whitespace-pre-wrap break-words' : 'w-max min-w-full'}`}>
          {lines.map((line, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} className="flex">
              <span className="sticky left-0 shrink-0 select-none bg-surface px-4 text-right text-subtle" style={{ width: `calc(${width}ch + 2rem)` }}>{i + 1}</span>
              <code className="min-w-0 flex-1 pr-6">{line || ' '}</code>
            </div>
          ))}
        </pre>
      </div>
      <Toolbar>
        <span className="font-mono text-xs text-muted tabular-nums">{lines.length.toLocaleString()} {lines.length === 1 ? 'line' : 'lines'}</span>
        <button className={`btn-ghost ml-auto h-8 px-2 text-xs ${wrap ? 'text-fg' : ''}`} onClick={() => setWrap((w) => !w)}
          aria-pressed={wrap}><WrapText className="h-3.5 w-3.5" /> Wrap lines</button>
      </Toolbar>
      {note && <Note>{note}</Note>}
    </div>
  );
}

// Markdown: rendered (GitHub-flavoured, sanitised) or source, with an outline
// of the document's headings to jump around in.
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');

function renderMarkdown(text) {
  const headings = [];
  const used = new Map();
  const renderer = new marked.Renderer();
  renderer.heading = function heading({ tokens, depth, text: raw }) {
    const base = `md-${slug(raw) || 'section'}`;
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    const id = n ? `${base}-${n}` : base;
    const inner = this.parser.parseInline(tokens);
    headings.push({ id, depth, text: inner.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") });
    return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
  };
  const html = marked.parse(text, { gfm: true, breaks: false, renderer, async: false });
  return { html: DOMPurify.sanitize(html, { ADD_ATTR: ['target'] }), headings };
}

// Links in a preview open in a new tab, never inside the app.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href') && !node.getAttribute('href').startsWith('#')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

function MarkdownView({ text, note }) {
  const [view, setView] = useState('rendered');
  const wide = () => window.matchMedia('(min-width: 768px)').matches;
  const [outline, setOutline] = useState(wide);
  const { html, headings } = useMemo(() => renderMarkdown(text), [text]);
  const body = useRef(null);
  const words = useMemo(() => (text.match(/\S+/g) || []).length, [text]);
  const top = Math.min(...headings.map((h) => h.depth), 6);

  const jump = useCallback((id) => {
    body.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (!wide()) setOutline(false);   // on a phone the outline covers the text
  }, []);
  // In-page links (#section) scroll the preview instead of changing the app's URL.
  const onClick = (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    jump(headings.some((h) => h.id === `md-${id}`) ? `md-${id}` : id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Tabs value={view} onChange={setView} options={[
          { value: 'rendered', label: 'Preview', icon: Eye },
          { value: 'source', label: 'Markdown', icon: Code },
        ]} />
        {view === 'rendered' && headings.length > 0 && (
          <button className={`btn-ghost ml-auto h-8 px-2 text-xs ${outline ? 'text-fg' : ''}`} onClick={() => setOutline((o) => !o)}
            aria-pressed={outline}><ListTree className="h-3.5 w-3.5" /> Outline</button>
        )}
      </div>
      {view === 'source' ? <div className="min-h-0 flex-1"><SourceView text={text} note={note} wrapDefault /></div> : (
        <>
          <div className="relative flex min-h-0 flex-1">
            {outline && headings.length > 0 && (
              <nav aria-label="Document outline" className="absolute inset-y-0 left-0 z-10 w-64 max-w-[85%] shrink-0 overflow-y-auto border-r border-line bg-surface px-2 py-3 shadow-lg md:static md:max-w-none md:shadow-none">
                <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-subtle">Outline</p>
                <ul>
                  {headings.map((h) => (
                    <li key={h.id}>
                      <button onClick={() => jump(h.id)} title={h.text}
                        className={`block w-full truncate rounded px-2 py-1 text-left text-[13px] hover:bg-surface-2 hover:text-fg ${
                          h.depth === top ? 'font-medium text-fg' : 'text-muted'}`}
                        style={{ paddingLeft: `${0.5 + (h.depth - top) * 0.85}rem` }}>
                        {h.text}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-line px-2 pt-3 text-xs text-subtle tabular-nums">
                  {headings.length} {headings.length === 1 ? 'heading' : 'headings'} · {words.toLocaleString()} words · {Math.max(1, Math.round(words / 230))} min read
                </p>
              </nav>
            )}
            <div ref={body} className="min-h-0 flex-1 overflow-y-auto bg-surface" data-keys onClick={onClick}>
              {/* Sanitised with DOMPurify above: no scripts, handlers or frames. */}
              {/* eslint-disable-next-line react/no-danger */}
              <article className="md-body mx-auto max-w-3xl px-5 py-8 sm:px-8" dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          </div>
          {note && <Note>{note}</Note>}
        </>
      )}
    </div>
  );
}

// CSV / TSV as a table (first 2,000 rows), or the raw text.
const MAX_ROWS = 2000;

function parseDelimited(text, sep) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length > MAX_ROWS) break;
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function CsvView({ text, tab, note }) {
  const [view, setView] = useState('table');
  const rows = useMemo(() => {
    const sep = tab ? '\t' : (text.split('\n', 1)[0].split(';').length > text.split('\n', 1)[0].split(',').length ? ';' : ',');
    return parseDelimited(text, sep);
  }, [text, tab]);
  const [head, ...body] = rows;
  const cols = Math.max(0, ...rows.map((r) => r.length));
  const more = body.length > MAX_ROWS - 1;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Tabs value={view} onChange={setView} options={[
          { value: 'table', label: 'Table', icon: Table },
          { value: 'source', label: 'Text', icon: Code },
        ]} />
        <span className="ml-auto font-mono text-xs text-muted tabular-nums">
          {body.length.toLocaleString()}{more ? '+' : ''} rows · {cols} columns
        </span>
      </div>
      {view === 'source' ? <div className="min-h-0 flex-1"><SourceView text={text} note={note} /></div> : (
        <>
          <div className="min-h-0 flex-1 overflow-auto bg-surface" data-keys>
            <table className="min-w-full border-separate border-spacing-0 text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="sticky left-0 z-10 border-b border-r border-line bg-surface-2 px-3 py-2 text-right font-mono text-xs font-normal text-subtle">#</th>
                  {Array.from({ length: cols }, (_, c) => (
                    <th key={c} className="whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2 text-left font-semibold">{head?.[c] ?? ''}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.slice(0, MAX_ROWS).map((r, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <tr key={i} className="hover:bg-surface-2">
                    <td className="sticky left-0 border-b border-r border-line bg-surface px-3 py-1.5 text-right font-mono text-xs text-subtle">{i + 1}</td>
                    {Array.from({ length: cols }, (_, c) => (
                      <td key={c} className="max-w-[28rem] truncate border-b border-line px-3 py-1.5" title={r[c]}>{r[c] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(note || more) && <Note>{more ? `Showing the first ${(MAX_ROWS - 1).toLocaleString()} rows. ` : ''}{note}</Note>}
        </>
      )}
    </div>
  );
}

function JsonView({ text, note }) {
  const pretty = useMemo(() => {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return null; }
  }, [text]);
  const [view, setView] = useState(pretty ? 'pretty' : 'source');
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Tabs value={view} onChange={setView} options={[
          ...(pretty ? [{ value: 'pretty', label: 'Formatted', icon: Braces }] : []),
          { value: 'source', label: 'Raw', icon: Code },
        ]} />
        {!pretty && <span className="ml-auto text-xs text-muted">{note ? 'Cut off, so it can’t be formatted' : 'Not valid JSON, shown as is'}</span>}
      </div>
      <div className="min-h-0 flex-1">
        <SourceView key={view} text={view === 'pretty' ? pretty : text} note={note} />
      </div>
    </div>
  );
}

// --- Small pieces ---------------------------------------------------------------
const Centered = ({ children }) => <div className="flex h-full items-center justify-center p-4">{children}</div>;

const Toolbar = ({ children }) => (
  <div className="flex items-center gap-1 border-t border-line bg-surface px-3 py-1.5">{children}</div>
);

const Note = ({ children }) => (
  <p className="border-t border-line bg-warning-soft px-4 py-2 text-xs text-fg">{children}</p>
);

function Message({ icon: I, title, text, action }) {
  return (
    <Centered>
      <div className="max-w-sm text-center">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-lg border border-line bg-surface text-muted">
          <I className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
        {text && <p className="mt-1 text-sm text-muted">{text}</p>}
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </Centered>
  );
}
