import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authApi } from '../api/authApi';

const AuthContext = createContext(null);
const LS = 'enclave.session';
const RENEW_EARLY_MS = 60 * 1000; // renew this long before the token expires
export const SESSION_EXPIRED_EVENT = 'enclave:session-expired';

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

const needsRenewal = (s) => Boolean(s) && tokenExpiry(s) - Date.now() <= RENEW_EARLY_MS;
const withExpiry = (tokens) => Date.now() + (tokens.expires_in || 3600) * 1000;

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; }
  });
  // True while an expired session is being renewed, so pages don't fire
  // requests with a dead token (and the user isn't bounced to /login).
  const [renewing, setRenewing] = useState(() => needsRenewal(session));
  const [notice, setNotice] = useState('');
  const inFlight = useRef(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    if (session) localStorage.setItem(LS, JSON.stringify(session));
    else localStorage.removeItem(LS);
  }, [session]);

  const expire = useCallback(() => {
    setSession(null);
    setNotice('Your session expired. Please sign in again.');
  }, []);

  // Swap the refresh token for fresh tokens (deduplicated across callers).
  const renew = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const refreshToken = sessionRef.current?.tokens?.refresh_token;
    if (!refreshToken) { expire(); return Promise.resolve(false); }
    setRenewing(true);
    inFlight.current = authApi.refreshToken({ refresh_token: refreshToken })
      .then((t) => {
        setSession((s) => s && {
          ...s,
          tokens: { ...s.tokens, ...t, refresh_token: t.refresh_token || s.tokens.refresh_token },
          expiresAt: withExpiry(t),
        });
        return true;
      })
      .catch(() => { expire(); return false; })
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
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [session, renew]);

  // The file API reports a rejected token (e.g. it expired mid-request): try
  // one renewal; if that fails the user is signed out with a clear message.
  useEffect(() => {
    const onRejected = () => { if (sessionRef.current) renew(); };
    window.addEventListener(SESSION_EXPIRED_EVENT, onRejected);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onRejected);
  }, [renew]);

  const signIn = useCallback(({ email, userId, tokens }) => {
    setNotice('');
    setSession({ email, userId, tokens, ts: Date.now(), expiresAt: withExpiry(tokens) });
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (session?.email && session?.tokens?.access_token) {
        await authApi.logout({ email: session.email, access_token: session.tokens.access_token });
      }
    } catch { /* best effort */ }
    setNotice('');
    setSession(null);
  }, [session]);

  const value = {
    session,
    isAuthenticated: Boolean(session?.tokens?.id_token && session?.userId),
    renewing,
    notice,
    signIn,
    signOut,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
