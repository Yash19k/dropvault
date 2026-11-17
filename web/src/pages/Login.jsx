import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Info } from 'lucide-react';
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
      signIn({ email, name: info.name, userId: info.user_id, tokens });
      navigate('/app');
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Sign in to manage your files."
      footer={<>New to DropVault? <Link to="/signup" className="link">Create an account</Link></>}
    >
      {!isConfigured() && (
        <div className="mb-5 flex items-start gap-2.5 rounded-md border border-line bg-surface-2 p-3 text-sm text-muted">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>This deployment is missing its API configuration. Set <code>VITE_AUTH_URL</code> at build time.</span>
        </div>
      )}
      {notice && (
        <div className="mb-5 flex items-start gap-2.5 rounded-md border border-accent/30 bg-accent-soft p-3 text-sm text-fg">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <span>{notice}</span>
        </div>
      )}
      <form onSubmit={login} className="space-y-4">
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com" autoComplete="email" autoFocus required />
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password" required />
        <button className="btn-primary h-10 w-full" disabled={busy}>
          {busy ? <Spinner /> : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}
