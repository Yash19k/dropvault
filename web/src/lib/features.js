// Feature switches for the web app, read from the API once per page load
// (GET /v1/features, public).
//
// email_sharing: "Share by email" appears by itself once AWS approves SES
// production access; before that, SES only delivers to verified addresses.
// The server decides (Terraform variable email_sharing: auto, on or off).
// Until the answer arrives, or if the API can't be reached, features stay off.
import { useEffect, useState } from 'react';
import { getConfig } from '../config';

const DEFAULTS = { email_sharing: false };
let cached = null;
let pending = null;

function load() {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    const { authUrl } = getConfig();
    pending = fetch(`${authUrl}/v1/features`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => { cached = { ...DEFAULTS, ...data }; return cached; })
      .catch(() => DEFAULTS) // not cached: the next page that asks tries again
      .finally(() => { pending = null; });
  }
  return pending;
}

export function useFeatures() {
  const [features, setFeatures] = useState(cached || DEFAULTS);
  useEffect(() => {
    let live = true;
    load().then((f) => { if (live) setFeatures(f); });
    return () => { live = false; };
  }, []);
  return features;
}
