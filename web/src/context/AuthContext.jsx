import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authApi } from '../api/authApi';

const AuthContext = createContext(null);
const LS = 'dropvault.session';
const LEGACY_LS = 'enclave.session'; // pre-rename key: migrated on load so nobody is signed out
const RENEW_EARLY_MS = 60 * 1000; // renew this long before the token expires
const RETRY_MS = 15 * 1000; // after a renewal that failed for network reasons
export const SESSION_EXPIRED_EVENT = 'dropvault:session-expired';

// When does the session's id token expire (ms epoch)?
function tokenExpiry(session) {
  if (session?.expiresAt) return session.expiresAt;
  try {
    // Older sessions didn't store expiresAt: read `exp` from the token itself.
    // Built-in auth tokens are "payload.sig"; standard JWTs are "header.payload.sig".
    const parts = session.tokens.id_token.split('.');
    const b64 = (parts.length === 3 ? parts[1] : parts[0]).replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    if (claims.exp) return claims.exp * 1000;
  } catch { /* unknown token format */ }
  return (session?.ts || 0) + 3600 * 1000;
}

// Sessions from before roles existed renew once to learn theirs.
const needsRenewal = (s) => Boolean(s) && (tokenExpiry(s) - Date.now() <= RENEW_EARLY_MS || !s.role);
const withExpiry = (tokens) => Date.now() + (tokens.expires_in || 3600) * 1000;

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => {
    try {
      const saved = localStorage.getItem(LS) || localStorage.getItem(LEGACY_LS);
      localStorage.removeItem(LEGACY_LS);
      return JSON.parse(saved || 'null');
    } catch { return null; }
  });
  // True while an expired session is being renewed, so pages don't fire
  // requests with a dead token (and the user isn't bounced to /login).
  const [renewing, setRenewing] = useState(() => needsRenewal(session));
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0); // bumped to try a failed renewal again
  const inFlight = useRef(null);
  const retryTimer = useRef(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  useEffect(() => {
    if (session) localStorage.setItem(LS, JSON.stringify(session));
    else localStorage.removeItem(LS);
  }, [session]);

  const expire = useCallback((message) => {
    setSession(null);
    setNotice(message || 'Your session expired. Please sign in again.');
  }, []);

  // Swap the refresh token for fresh tokens (deduplicated across callers).
  const renew = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const refreshToken = sessionRef.current?.tokens?.refresh_token;
    if (!refreshToken) { expire(); return Promise.resolve(false); }
    // Only hold the pages back when the token has already expired. The routine
    // renewal a minute early must not unmount the dashboard (open dialogs, the
    // upload tray, a one-time password on screen).
    if (tokenExpiry(sessionRef.current) <= Date.now()) setRenewing(true);
    inFlight.current = authApi.refreshToken({ refresh_token: refreshToken })
      .then((t) => {
        setSession((s) => s && {
          ...s,
          tokens: { ...s.tokens, ...t, refresh_token: t.refresh_token || s.tokens.refresh_token },
          expiresAt: withExpiry(t),
          role: t.role || s.role || 'user',
        });
        return true;
      })
      .catch((err) => {
        // 401: the session was ended (signed out elsewhere, password changed);
        // 403: the account was suspended (the message says so).
        if (err?.status === 401 || err?.status === 403) {
          expire(err.status === 403 ? err.message : undefined);
          return false;
        }
        // Offline, a laptop just waking up, or a server hiccup: stay signed in
        // and try again shortly (and as soon as the network is back).
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => setRetry((n) => n + 1), RETRY_MS);
        return false;
      })
      .finally(() => { inFlight.current = null; setRenewing(false); });
    return inFlight.current;
  }, [expire]);

  // Renew shortly before expiry; re-check when the tab becomes visible again
  // (timers don't fire reliably while a laptop sleeps).
  useEffect(() => {
    if (!session) return undefined;
    const check = () => { if (needsRenewal(sessionRef.current)) renew(); };
    check();
    const timer = setTimeout(check, Math.max(0, tokenExpiry(session) - Date.now() - RENEW_EARLY_MS));
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
    };
  }, [session, renew, retry]);

  // The file API reports a rejected token (e.g. it expired mid-request): try
  // one renewal; if that fails the user is signed out with a clear message.
  useEffect(() => {
    const onRejected = () => { if (sessionRef.current) renew(); };
    window.addEventListener(SESSION_EXPIRED_EVENT, onRejected);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onRejected);
  }, [renew]);

  // tokens is the sign-in / sign-up response, which also carries the role.
  const signIn = useCallback(({ email, name, userId, tokens }) => {
    setNotice('');
    setSession({ email, name, userId, tokens, role: tokens.role || 'user', ts: Date.now(), expiresAt: withExpiry(tokens) });
  }, []);

  const signOut = useCallback(async () => {
    try {
      // The refresh token too: the access token may have expired while the tab
      // slept, and the refresh token is the one that would keep the session alive.
      if (session?.tokens?.access_token || session?.tokens?.refresh_token) {
        await authApi.logout({ access_token: session.tokens.access_token, refresh_token: session.tokens.refresh_token });
      }
    } catch { /* best effort */ }
    setNotice('');
    setSession(null);
  }, [session]);

  // The current id token, read at call time: long uploads outlive a token.
  const getToken = useCallback(() => sessionRef.current?.tokens?.id_token, []);

  // New password; other devices are signed out, this one gets fresh tokens.
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const t = await authApi.changePassword(sessionRef.current?.tokens?.access_token, {
      current_password: currentPassword, new_password: newPassword,
    });
    setSession((s) => s && {
      ...s, tokens: { ...s.tokens, ...t }, expiresAt: withExpiry(t), role: t.role || s.role,
    });
  }, []);

  const value = {
    session,
    isAuthenticated: Boolean(session?.tokens?.id_token && session?.userId),
    isAdmin: session?.role === 'admin',
    renewing,
    notice,
    signIn,
    signOut,
    getToken,
    changePassword,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
