import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import { Field, PasswordField, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/authApi';
import { isConfigured } from '../config';

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
    if (password !== confirm) { toast.error(new Error('Passwords do not match.')); return; }
    setBusy(true);
    try {
      const r = await authApi.createUser({ full_name: fullName, email, password });
      signIn({ email: r.email || email, userId: r.user_id, tokens: r });
      toast.success('Account created — welcome!');
      navigate('/app');
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Create your account" subtitle="Just your name, email and a password.">
      {!isConfigured() && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          This deployment is missing its auth API configuration.
        </div>
      )}
      <form onSubmit={register} className="space-y-4">
        <Field label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ada Lovelace" autoComplete="name" required />
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required hint="At least 8 characters." />
        <PasswordField label="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
        <button className="btn-primary w-full justify-center" disabled={busy}>
          {busy ? <Spinner /> : <><UserPlus className="h-4 w-4" /> Create account</>}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-400">
        Already have an account? <Link to="/login" className="text-brand-400 hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
