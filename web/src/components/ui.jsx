import { useState } from 'react';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { APP_NAME } from '../brand';

export const Logo = ({ className = 'h-8' }) => (
  <img src="/enclave-logo.png" alt={APP_NAME} className={`w-auto rounded-md ${className}`} />
);

export const Spinner = ({ className = '' }) => <Loader2 className={`h-4 w-4 animate-spin ${className}`} />;

export function Field({ label, hint, ...props }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <input className="input" {...props} />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function PasswordField({ label, hint, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <div className="relative">
        <input type={show ? 'text' : 'password'} className="input pr-10" {...props} />
        <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
