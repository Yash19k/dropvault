// Site heartbeats for the admin panel's Analytics page and "online now".
//
// While a tab is open, visible and in use, it tells the API (POST /v1/presence)
// every 30 seconds, plus once per page change and once when the tab closes.
// A tab nobody has touched for 5 minutes stops sending, so it drops off
// "online now". Ids are random: `vid` per browser (localStorage), `sid` per
// tab (sessionStorage). When someone is signed in the session token goes
// along, so the visit is linked to their account. Nothing here ever blocks or
// breaks the app: every failure is ignored.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getConfig } from '../config';
import { useAuth } from '../context/AuthContext';

const BEAT_MS = 30_000;
const IDLE_MS = 5 * 60_000;
const MAX_SECS = 60;
const VID_KEY = 'dropvault.vid';
const SID_KEY = 'dropvault.sid';
const REF_KEY = 'dropvault.ref-sent';
// The last page view sent: React StrictMode mounts twice in development.
let lastView = { page: null, at: 0 };

function randomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Storage can be blocked (private mode, strict settings): fall back to memory.
function stored(storage, key) {
  try {
    const existing = storage.getItem(key);
    if (existing) return { id: existing, fresh: false };
    const id = randomId();
    storage.setItem(key, id);
    return { id, fresh: true };
  } catch {
    return { id: randomId(), fresh: true };
  }
}

function externalReferrer() {
  try {
    if (sessionStorage.getItem(REF_KEY)) return null;
    sessionStorage.setItem(REF_KEY, '1');
  } catch { /* count it once per page load instead */ }
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    return ref && ref.host !== window.location.host ? ref.host : null;
  } catch {
    return null;
  }
}

export function Presence() {
  const { pathname } = useLocation();
  const { session } = useAuth();
  const token = useRef(null);
  token.current = session?.tokens?.id_token || null;
  const page = useRef(pathname);
  page.current = pathname;
  const state = useRef(null);

  // One-time setup: ids, timers, and the listeners that keep the count honest.
  useEffect(() => {
    const { fileUrl } = getConfig();
    if (!fileUrl) return undefined;
    const visitor = stored(localStorage, VID_KEY);
    const tab = stored(sessionStorage, SID_KEY);
    const s = {
      vid: visitor.id, sid: tab.id, isNew: visitor.fresh, ref: externalReferrer(),
      last: Date.now(), lastInput: Date.now(),
      tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } })(),
    };
    state.current = s;

    const active = () => document.visibilityState === 'visible' && Date.now() - s.lastInput < IDLE_MS;

    // Seconds the tab was visible and in use since the last heartbeat.
    const take = () => {
      const now = Date.now();
      const secs = active() ? Math.min(MAX_SECS, Math.round((now - s.last) / 1000)) : 0;
      s.last = now;
      return secs;
    };

    s.send = (extra = {}) => {
      const body = { sid: s.sid, vid: s.vid, page: page.current, secs: take(), tz: s.tz, ...extra };
      if (s.isNew) { body.new = true; s.isNew = false; }
      if (s.ref) { body.ref = s.ref; s.ref = null; }
      const headers = { 'Content-Type': 'application/json' };
      if (token.current) headers.Authorization = `Bearer ${token.current}`;
      fetch(`${fileUrl}/v1/presence`, {
        method: 'POST', headers, body: JSON.stringify(body), keepalive: true, credentials: 'omit',
      }).catch(() => {});
    };

    const timer = setInterval(() => { if (active()) s.send(); }, BEAT_MS);

    // Coming back after being idle or hidden: say so at once (shows as online).
    let wasActive = true;
    const onInput = () => {
      const idle = Date.now() - s.lastInput >= IDLE_MS;
      s.lastInput = Date.now();
      if (idle && document.visibilityState === 'visible') { s.last = Date.now(); s.send(); }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        s.lastInput = Date.now();
        s.last = Date.now();
        if (!wasActive) s.send();
        wasActive = true;
      } else {
        // hand in the seconds so far before the tab goes to the background
        const inUse = Date.now() - s.lastInput < IDLE_MS;
        const secs = inUse ? Math.min(MAX_SECS, Math.round((Date.now() - s.last) / 1000)) : 0;
        wasActive = false;
        if (secs) s.send({ secs });
        s.last = Date.now();
      }
    };
    const onLeave = () => s.send({ leave: true });

    const inputs = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
    let throttled = 0;
    const onAnyInput = () => {
      const now = Date.now();
      if (now - throttled < 1000) return;
      throttled = now;
      onInput();
    };
    inputs.forEach((e) => window.addEventListener(e, onAnyInput, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onLeave);
    return () => {
      clearInterval(timer);
      inputs.forEach((e) => window.removeEventListener(e, onAnyInput));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onLeave);
      state.current = null;
    };
  }, []);

  // A page view on every route change (StrictMode's double run counts once).
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const now = Date.now();
    if (lastView.page === pathname && now - lastView.at < 1500) return;
    lastView = { page: pathname, at: now };
    s.send({ view: true });
  }, [pathname]);

  return null;
}
