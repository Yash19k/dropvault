import { createContext, useContext, useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

// Theme preference: 'light' | 'dark' | 'system'. index.html applies the saved
// value before first paint; this keeps it in sync afterwards.
const KEY = 'dropvault.theme';
const ThemeContext = createContext({ pref: 'system', setPref: () => {} });

function readPref() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState(readPref);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || (pref === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    try { localStorage.setItem(KEY, pref); } catch { /* storage unavailable */ }
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);

  return <ThemeContext.Provider value={{ pref, setPref }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

// Segmented Light / Dark / System control.
export function ThemeToggle({ className = '' }) {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme"
      className={`inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 ${className}`}>
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = pref === value;
        return (
          <button key={value} type="button" role="radio" aria-checked={active} title={`${label} theme`}
            onClick={() => setPref(value)}
            className={`grid h-7 w-8 place-items-center rounded-[5px] transition-colors ${
              active ? 'bg-surface text-fg shadow-xs' : 'text-subtle hover:text-fg'}`}>
            <Icon className="h-3.5 w-3.5" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
