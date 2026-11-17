// Auth client (email + password sign-up / sign-in, userinfo).
import { getConfig } from '../config';

async function request(method, path, { body, token } = {}) {
  const { authUrl } = getConfig();
  if (!authUrl) throw Object.assign(new Error('Auth API is not configured (open Settings).'), { status: 0 });
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${authUrl}/v1${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    throw Object.assign(new Error(data?.error_message || data?.message || `Request failed (${res.status})`),
      { status: res.status, data });
  }
  return data;
}

export const authApi = {
  // sign-up: { full_name, email, password } -> { user_id, id_token, access_token, ... }
  createUser: (b) => request('POST', '/users', { body: b }),
  // sign-in: { email, password } -> tokens
  login: (b) => request('POST', '/login', { body: b }),
  refreshToken: (b) => request('POST', '/refresh-token', { body: b }),
  logout: (b) => request('POST', '/logout', { body: b }),
  userInfo: (idToken) => request('GET', '/userinfo', { token: idToken }),
};
