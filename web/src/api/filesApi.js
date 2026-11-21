// File API client: uploads (single PUT or resumable multipart, straight to S3),
// list / download / delete / share, and short links with stats.
import { getConfig } from '../config';
import { SESSION_EXPIRED_EVENT } from '../context/AuthContext';

// Shared by the admin API client (adminApi.js).
export async function apiRequest(method, path, { body, token } = {}) {
  const { fileUrl } = getConfig();
  if (!fileUrl) throw Object.assign(new Error('File API is not configured (open Settings).'), { status: 0 });
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${fileUrl}/v1${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (res.status === 401 && token) {
    // Token rejected (expired): AuthContext renews it or signs the user out with
    // a clear message, so this error is not shown as a toast.
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw Object.assign(new Error('Your session expired.'), { status: 401, data, silent: true });
  }
  if (!res.ok) {
    throw Object.assign(new Error(data?.error_message || data?.message || `Request failed (${res.status})`),
      { status: res.status, data });
  }
  return data;
}

const request = apiRequest;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The API accepts 1-255 chars with no slashes or control characters.
function safeFileName(name) {
  // eslint-disable-next-line no-control-regex
  const cleaned = (name || '').replace(/[/\\\u0000-\u001f\u007f]/g, '_').trim();
  const safe = !cleaned || cleaned === '.' || cleaned === '..' ? 'file' : cleaned;
  if (safe.length <= 255) return safe;
  const dot = safe.lastIndexOf('.');
  const ext = dot > 0 && safe.length - dot <= 16 ? safe.slice(dot) : '';
  return safe.slice(0, 255 - ext.length) + ext;
}

// One browser -> S3 PUT against a presigned URL, reporting bytes sent.
function put(url, body, { headers = {}, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(Object.assign(new Error(`Upload to storage failed (${xhr.status})`), { status: xhr.status })));
    xhr.onerror = () => reject(new Error('Network error while uploading to storage.'));
    xhr.onabort = () => reject(Object.assign(new Error('Upload paused.'), { aborted: true }));
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

// --- Resume info --------------------------------------------------------------
// A multipart upload can be picked up again after a reload: we remember which
// server-side upload belongs to which local file (same name, size and date).
const RESUME_KEY = 'dropvault.uploads';
const fileKey = (userId, file) => `${userId}|${file.name}|${file.size}|${file.lastModified}`;
function readResume() {
  try { return JSON.parse(localStorage.getItem(RESUME_KEY) || '{}'); } catch { return {}; }
}
function saveResume(key, value) {
  const all = readResume();
  if (value) all[key] = value; else delete all[key];
  try { localStorage.setItem(RESUME_KEY, JSON.stringify(all)); } catch { /* storage full or blocked */ }
}
export function resumableFileIds() {
  return new Set(Object.values(readResume()).map((v) => v.fileId));
}

const PARALLEL_PARTS = 4;
const PART_RETRIES = 4;
const URL_BATCH = 50;

// Upload the parts S3 doesn't have yet, several at a time, retrying each part.
async function uploadParts({ userId, getToken, fileId, file, partSize, partCount, onProgress, signal }) {
  const base = `/users/${userId}/files/${fileId}/parts`;
  const first = await request('POST', base, { token: getToken(), body: { part_numbers: [], include_uploaded: true } });
  const done = new Set(first.uploaded_parts || []);
  const partBytes = (n) => Math.min(partSize, file.size - (n - 1) * partSize);
  let sent = [...done].reduce((sum, n) => sum + partBytes(n), 0);
  const inflight = new Map();
  const report = () => {
    const now = [...inflight.values()].reduce((a, b) => a + b, 0);
    onProgress?.(Math.min(99, Math.floor(((sent + now) / file.size) * 100)));
  };
  report();

  const todo = [];
  for (let n = 1; n <= partCount; n += 1) if (!done.has(n)) todo.push(n);
  // Presigned part URLs are fetched in batches; workers share in-flight batches.
  const urls = {};
  const pending = {};
  const urlFor = async (n) => {
    if (urls[n]) return urls[n];
    if (!pending[n]) {
      const batch = todo.filter((p) => p >= n && !urls[p] && !pending[p]).slice(0, URL_BATCH);
      const fetched = request('POST', base, { token: getToken(), body: { part_numbers: batch } })
        .then((r) => { Object.assign(urls, r.urls); })
        .finally(() => batch.forEach((p) => { delete pending[p]; }));
      batch.forEach((p) => { pending[p] = fetched; });
    }
    await pending[n];
    return urls[n];
  };

  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      if (signal?.aborted) throw Object.assign(new Error('Upload paused.'), { aborted: true });
      const n = todo[next]; next += 1;
      const blob = file.slice((n - 1) * partSize, (n - 1) * partSize + partBytes(n));
      for (let attempt = 1; ; attempt += 1) {
        try {
          await put(await urlFor(n), blob, { signal, onProgress: (b) => { inflight.set(n, b); report(); } });
          break;
        } catch (err) {
          inflight.delete(n);
          if (err.aborted || attempt >= PART_RETRIES) throw err;
          if (err.status === 403) delete urls[n];          // presigned URL expired: get a new one
          await sleep(1000 * 2 ** (attempt - 1));
        }
      }
      inflight.delete(n);
      sent += partBytes(n);
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, todo.length || 1) }, worker));
}

export const filesApi = {
  // Full upload of one File. getToken() returns the current id token (long
  // uploads outlive a single token). Small files go up in one PUT; big ones in
  // parts that survive dropped connections and can be resumed later, even
  // after a reload, by uploading the same file again.
  // onStarted(fileId, resumable) fires as soon as the server knows the file.
  async upload({ userId, getToken, file, onProgress, onStarted, signal }) {
    const key = fileKey(userId, file);
    const saved = readResume()[key];
    if (saved) {
      onStarted?.(saved.fileId, true);
      try {
        await uploadParts({ userId, getToken, file, signal, onProgress, ...saved });
        await request('POST', `/users/${userId}/files/${saved.fileId}/complete`, { token: getToken() });
        saveResume(key, null);
        onProgress?.(100);
        return saved.fileId;
      } catch (err) {
        if (![404, 409, 410].includes(err.status)) throw Object.assign(err, { resumable: true });
        saveResume(key, null);   // that upload is gone on the server: start over below
      }
    }

    const contentType = file.type || 'application/octet-stream';
    const start = await request('POST', `/users/${userId}/files`, {
      token: getToken(),
      body: { file_name: safeFileName(file.name), content_type: contentType, size: file.size },
    });
    onStarted?.(start.file_id, start.upload_type === 'multipart');

    if (start.upload_type === 'multipart') {
      const info = { fileId: start.file_id, partSize: start.part_size, partCount: start.part_count };
      saveResume(key, info);
      try {
        await uploadParts({ userId, getToken, file, signal, onProgress, ...info });
        await request('POST', `/users/${userId}/files/${start.file_id}/complete`, { token: getToken() });
      } catch (err) {
        if (err.status === 413) saveResume(key, null);
        throw Object.assign(err, { resumable: err.status !== 413 });
      }
      saveResume(key, null);
      onProgress?.(100);
      return start.file_id;
    }

    try {
      await put(start.upload_url, file, {
        signal,
        headers: { 'Content-Type': contentType, ...(start.upload_headers || {}) },
        onProgress: (b) => onProgress?.(Math.min(99, Math.round((b / (file.size || 1)) * 100))),
      });
      await request('POST', `/users/${userId}/files/${start.file_id}/complete`, { token: getToken() });
    } catch (err) {
      // Don't leave a record stuck on "Uploading…": remove it (best effort).
      request('DELETE', `/users/${userId}/files/${start.file_id}`, { token: getToken(), body: {} }).catch(() => {});
      throw err;
    }
    onProgress?.(100);
    return start.file_id;
  },

  // -> { user_files, usage: { used_bytes, quota_bytes } }
  list: (userId, idToken) => request('GET', `/users/${userId}/files`, { token: idToken }),

  download: (userId, fileId, idToken) =>
    request('GET', `/users/${userId}/files/${fileId}/download`, { token: idToken }),

  // Short (~80 char) public link for copy-link and QR codes; redirects to a
  // fresh download. expiresIn: seconds (see LINK_EXPIRY) or 'never';
  // maxDownloads: a number or null (unlimited).
  createLink: (userId, fileId, idToken, { expiresIn, maxDownloads, channel }) =>
    request('POST', `/users/${userId}/files/${fileId}/qr`, {
      token: idToken, body: { expires_in: expiresIn, max_downloads: maxDownloads, channel },
    }),

  // Every link made for the file, with download stats.
  links: (userId, fileId, idToken) =>
    request('GET', `/users/${userId}/files/${fileId}/links`, { token: idToken }),

  revokeLink: (userId, fileId, code, idToken) =>
    request('DELETE', `/users/${userId}/files/${fileId}/links/${encodeURIComponent(code)}`, { token: idToken }),

  // Turn off every link made so far for this file (email, copied and QR).
  revokeLinks: (userId, fileId, idToken) =>
    request('DELETE', `/users/${userId}/files/${fileId}/qr`, { token: idToken }),

  remove: (userId, fileId, idToken) =>
    request('DELETE', `/users/${userId}/files/${fileId}`, { token: idToken, body: {} }),

  share: (userId, fileId, idToken, emails, { expiresIn, maxDownloads }) =>
    request('POST', `/users/${userId}/files/${fileId}/share`, {
      token: idToken, body: { share_with: emails, expires_in: expiresIn, max_downloads: maxDownloads },
    }),
};

// Link lifetimes offered in the UI; the API accepts exactly these.
export const LINK_EXPIRY = [
  { value: 900, label: '15 minutes' },
  { value: 3600, label: '1 hour' },
  { value: 21600, label: '6 hours' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '7 days' },
  { value: 'never', label: 'Never' },
];
export const DEFAULT_EXPIRY = 3600;

// Download limits offered in the UI (the API accepts 1-1000 or null).
export const DOWNLOAD_LIMITS = [
  { value: null, label: 'Unlimited' },
  { value: 1, label: '1 download' },
  { value: 3, label: '3 downloads' },
  { value: 5, label: '5 downloads' },
  { value: 10, label: '10 downloads' },
  { value: 25, label: '25 downloads' },
];
