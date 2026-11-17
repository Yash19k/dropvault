import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
      title="Create your account"
      subtitle="Free to use. No credit card, no email verification."
      footer={<>Already have an account? <Link to="/login" className="link">Sign in</Link></>}
    >
      {!isConfigured() && (
        <div className="mb-5 rounded-md border border-line bg-surface-2 p-3 text-sm text-muted">
          This deployment is missing its auth API configuration.
        </div>
      )}
      <form onSubmit={register} className="space-y-4">
        <Field label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)}
          placeholder="Ada Lovelace" autoComplete="name" autoFocus required />
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com" autoComplete="email" required />
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password" minLength={8} required hint="At least 8 characters." />
        <PasswordField label="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password" minLength={8} required />
        <button className="btn-primary h-10 w-full" disabled={busy}>
          {busy ? <Spinner /> : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}
