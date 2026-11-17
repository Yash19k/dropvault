// Enclave is configured at BUILD/DEPLOY time, like any microservice that depends
// on another. Its dependencies are wired in via Vite env vars (set before
// `npm run build`), NOT at runtime by the end user:
//   - Auth API    (auth: sign-up, login, userinfo)      -> VITE_AUTH_URL
//   - the File API (upload, list, download, delete, share) -> VITE_FILE_URL
// If the File API vars are omitted, they fall back to the auth ones (single gateway).

const strip = (u) => (u || '').replace(/\/$/, '');

export function getConfig() {
  const authUrl = strip(import.meta.env.VITE_AUTH_URL || '');
  const fileUrl = strip(import.meta.env.VITE_FILE_URL || '') || authUrl;
  return { authUrl, fileUrl };
}

export function isConfigured() {
  const c = getConfig();
  return Boolean(c.authUrl && c.fileUrl);
}
