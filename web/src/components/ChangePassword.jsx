import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Modal, PasswordField, Spinner } from './ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';

// Change your own password. Other devices are signed out; this one stays
// signed in with fresh tokens. Also how an admin-issued temporary password
// gets replaced.
export default function ChangePasswordDialog({ onClose }) {
  const { changePassword } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < 8) { setError('The new password must be at least 8 characters.'); return; }
    if (next !== again) { setError('The new passwords don’t match.'); return; }
    if (next === current) { setError('Choose a password different from the current one.'); return; }
    setBusy(true);
    try {
      await changePassword(current, next);
      toast.success('Password changed. Other devices have been signed out.');
      onClose();
    } catch (err) {
      setError(err.message || 'Could not change the password.');
      setBusy(false);
    }
  };

  return (
    <Modal onClose={busy ? () => {} : onClose} title="Change password" icon={KeyRound}
      footer={<>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="change-password" className="btn-primary" disabled={busy || !current || !next || !again}>
          {busy ? <Spinner /> : 'Change password'}
        </button>
      </>}>
      <form id="change-password" onSubmit={submit} className="space-y-4">
        <PasswordField label="Current password" autoComplete="current-password" value={current}
          onChange={(e) => setCurrent(e.target.value)} autoFocus required />
        <PasswordField label="New password" hint="At least 8 characters." autoComplete="new-password" value={next}
          onChange={(e) => setNext(e.target.value)} minLength={8} maxLength={256} required />
        <PasswordField label="New password again" autoComplete="new-password" value={again}
          onChange={(e) => setAgain(e.target.value)} maxLength={256} required />
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <p className="text-xs text-muted">You stay signed in here. Every other device is signed out.</p>
      </form>
    </Modal>
  );
}
