import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, AlertTriangle } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import { Field, PasswordField, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/authApi';
import { isConfigured } from '../config';

export default function Login() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, notice } = useAuth();

  const [email, setEmail] = useState(location.state?.email || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const login = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const tokens = await authApi.login({ email, password });
      // resolve the user_id needed for file API paths
      const info = await authApi.userInfo(tokens.id_token);
      signIn({ email, userId: info.user_id, tokens });
      toast.success('Signed in.');
      navigate('/app');
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in with your email and password to manage your files.">
      {!isConfigured() && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <span>This deployment is missing its API configuration. Set <code>VITE_AUTH_URL</code> (and the file API vars) at build time.</span>
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-brand-500/30 bg-brand-500/10 p-3 text-sm text-slate-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
          <span>{notice}</span>
        </div>
      )}
      <form onSubmit={login} className="space-y-4">
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        <button className="btn-primary w-full justify-center" disabled={busy}>
          {busy ? <Spinner /> : <><KeyRound className="h-4 w-4" /> Sign in</>}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-400">
        No account yet? <Link to="/signup" className="text-brand-400 hover:underline">Create one</Link>
      </p>
    </AuthShell>
  );
}
