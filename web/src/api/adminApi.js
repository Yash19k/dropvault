// Admin panel API client (/v1/admin/...). The server checks on every request
// that the caller is an admin; the session's role only decides what to show.
import { apiRequest } from './filesApi';

const enc = encodeURIComponent;
const get = (path) => (token) => apiRequest('GET', `/admin${path}`, { token });
const send = (method, path, token, body = {}) => apiRequest(method, `/admin${path}`, { token, body });

export const adminApi = {
  overview: get('/overview'),
  users: get('/users'),
  files: get('/files'),
  links: get('/links'),
  activity: get('/activity'),
  system: get('/system'),
  // range: '1h' | '24h' | '7d'
  health: (range, token) => apiRequest('GET', `/admin/health?range=${enc(range)}`, { token }),
  // range: '24h' | '7d' | '30d' | '90d'; tz: minutes east of UTC
  analytics: (range, tz, token) => apiRequest('GET', `/admin/analytics?range=${enc(range)}&tz=${enc(tz)}`, { token }),
  live: get('/analytics/live'),
  user: (userId, token) => apiRequest('GET', `/admin/users/${enc(userId)}`, { token }),

  // changes: { role?: 'admin'|'user', suspended?: bool, quota_bytes?: number|null }
  updateUser: (userId, changes, token) => send('PATCH', `/users/${enc(userId)}`, token, changes),
  signOutUser: (userId, token) => send('POST', `/users/${enc(userId)}/signout`, token),
  resetPassword: (userId, token) => send('POST', `/users/${enc(userId)}/password`, token),
  deleteUser: (userId, token) => send('DELETE', `/users/${enc(userId)}`, token),

  downloadFile: (fileId, token) => apiRequest('GET', `/admin/files/${enc(fileId)}/download`, { token }),
  deleteFile: (fileId, token) => send('DELETE', `/files/${enc(fileId)}`, token),
  revokeFileLinks: (fileId, token) => send('DELETE', `/files/${enc(fileId)}/links`, token),
  revokeLink: (code, token) => send('DELETE', `/links/${enc(code)}`, token),
};
