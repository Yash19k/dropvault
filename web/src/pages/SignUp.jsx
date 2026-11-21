import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Circle, CircleCheck } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import { Field, PasswordField, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/authApi';
import { isConfigured } from '../config';

// A password rule that ticks itself off as you type.
function Rule({ ok, children }) {
  const Icon = ok ? CircleCheck : Circle;
  return (
    <span className={`inline-flex items-center gap-1.5 transition-colors ${ok ? 'text-accent' : 'text-muted'}`}>
      <Icon className="h-3.5 w-3.5" /> {children}
    </span>
  );
}

export default function SignUp() {
  const toast = useToast();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const register = async (e) => {
    e.preventDefault();
    if (password !== confirm) { toast.error('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const r = await authApi.createUser({ full_name: fullName, email, password });
      signIn({ email: r.email || email, name: fullName.trim(), userId: r.user_id, tokens: r });
      toast.success('Account created.');
      navigate('/app');
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };

  return (
    <AuthShell
      eyebrow="Free account"
      title="Create your account"
      subtitle="No credit card and no email verification. Name, email and a password."
      footer={<>Already have an account? <Link to="/login" className="link">Sign in</Link></>}
      aside={{
        eyebrow: 'Every link gets a clock',
        title: 'Send your first file in under a minute.',
        points: ['Links that expire when you choose', 'Download limits and stats', 'Resumable big uploads'],
      }}
    >
      {!isConfigured() && (
        <div className="mb-5 flex items-start gap-2.5 rounded-md border border-line bg-surface-2 p-3 text-sm text-muted">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>This deployment is missing its API configuration. Set <code>VITE_AUTH_URL</code> at build time.</span>
        </div>
      )}
      <form onSubmit={register} className="space-y-4">
        <Field label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)}
          placeholder="Ada Lovelace" autoComplete="name" autoFocus required />
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com" autoComplete="email" required />
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password" minLength={8} required
          hint={<Rule ok={password.length >= 8}>At least 8 characters</Rule>} />
        <PasswordField label="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password" minLength={8} required
          hint={confirm ? <Rule ok={confirm === password}>{confirm === password ? 'Passwords match' : 'Passwords don’t match yet'}</Rule> : undefined} />
        <button className="btn-primary group mt-2 h-11 w-full text-[15px] shadow-lg shadow-accent/25" disabled={busy}>
          {busy ? <Spinner /> : <>Create account <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
        </button>
      </form>
    </AuthShell>
  );
}
