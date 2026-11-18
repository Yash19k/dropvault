// File API client: create-upload (presigned PUT) -> browser PUT to S3 ->
// complete, plus list / download / delete / share.
import { getConfig } from '../config';
import { SESSION_EXPIRED_EVENT } from '../context/AuthContext';

async function request(method, path, { body, token } = {}) {
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

// Direct browser -> S3 PUT against a presigned URL, with progress.
// extraHeaders carries the SSE-KMS headers when per-user encryption is on.
function putToS3(uploadUrl, file, contentType, onProgress, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
    for (const [k, v] of Object.entries(extraHeaders || {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new Error(`Upload to storage failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Network error while uploading to storage.'));
    xhr.send(file);
  });
}

export const filesApi = {
  // full upload lifecycle for one File object
  async upload({ userId, idToken, file, onProgress }) {
    const contentType = file.type || 'application/octet-stream';
    const start = await request('POST', `/users/${userId}/files`, {
      token: idToken,
      body: { file_name: file.name, content_type: contentType, size: file.size },
    });
    await putToS3(start.upload_url, file, contentType, onProgress, start.upload_headers);
    await request('POST', `/users/${userId}/files/${start.file_id}/complete`, { token: idToken });
    return start.file_id;
  },

  list: (userId, idToken) => request('GET', `/users/${userId}/files`, { token: idToken }),

  download: (userId, fileId, idToken) =>
    request('GET', `/users/${userId}/files/${fileId}/download`, { token: idToken }),

  // Short (~80 char) public link for copy-link and QR codes; redirects to a
  // fresh download. expiresIn: seconds (see LINK_EXPIRY) or 'never'.
  qrLink: (userId, fileId, idToken, expiresIn) =>
    request('POST', `/users/${userId}/files/${fileId}/qr`, {
      token: idToken, body: { expires_in: expiresIn },
    }),

  // Turn off every link made so far for this file (email, copied and QR).
  revokeLinks: (userId, fileId, idToken) =>
    request('DELETE', `/users/${userId}/files/${fileId}/qr`, { token: idToken }),

  remove: (userId, fileId, idToken) =>
    request('DELETE', `/users/${userId}/files/${fileId}`, { token: idToken, body: {} }),

  share: (userId, fileId, idToken, emails, expiresIn) =>
    request('POST', `/users/${userId}/files/${fileId}/share`, {
      token: idToken, body: { share_with: emails, expires_in: expiresIn },
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
