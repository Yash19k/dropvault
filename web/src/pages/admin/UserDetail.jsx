import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ShieldCheck, ShieldOff, Ban, CircleCheck, HardDrive, KeyRound, LogOut, Trash2, Copy, Check,
  Files, Link2, History,
} from 'lucide-react';
import { Modal, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { adminApi } from '../../api/adminApi';
import { formatBytes, formatCount, formatDate, formatRelative, plural } from '../../lib/format';
import ActivityList from './ActivityList';
import { FileTable, LinkTable } from './tables';
import {
  useAdminData, useAction, RefreshButton, StatTile, Segmented, Dimmed, AdminError, LoadingRows,
  EmptyState, Avatar, AccountBadges, ConfirmDialog, quotaTone,
} from './ui';

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const QUOTA_CHOICES = [1, 5, 10, 25, 50, 100, 250, 500, 1024].map((n) => n * GB);

export default function UserDetail() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const load = useCallback((token) => adminApi.user(userId, token), [userId]);
  const { data, error, loading, reload, token } = useAdminData(load);
  const [tab, setTab] = useState('files');
  const [dialog, setDialog] = useState(null);
  const { run } = useAction();

  if (error && !data) {
    return (
      <div>
        <BackLink />
        <div className="mt-4">
          {error.status === 404
            ? <div className="panel"><EmptyState title="User not found">This account may have been deleted.</EmptyState></div>
            : <AdminError error={error} onRetry={reload} />}
        </div>
      </div>
    );
  }
  if (!data) return <div><BackLink /><div className="panel mt-4"><LoadingRows rows={3} /></div></div>;

  const u = data.user;
  const self = u.user_id === session.userId;
  const locked = self
    ? 'You can’t do this to your own account.'
    : u.owner ? 'Owner admins are set in the deployment (admin_emails) and can’t be changed here.' : null;
  const name = u.name || u.email;
  const change = (changes, message) => run('change', () => adminApi.updateUser(u.user_id, changes, token), message).then(reload);
  const pct = u.quota_bytes ? (u.used_bytes / u.quota_bytes) * 100 : 0;

  return (
    <div>
      <BackLink />

      {/* Who */}
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <Avatar name={u.name} email={u.email} size="h-12 w-12 text-base" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">{name}</h1>
              <AccountBadges user={u} />
              {self && <span className="text-xs text-muted">(you)</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <span className="truncate">{u.email}</span>
              <span aria-hidden="true">·</span>
              <CopyId id={u.user_id} />
            </div>
          </div>
        </div>
        <RefreshButton onClick={reload} loading={loading} />
      </div>

      {/* Actions */}
      <div className="mt-5 flex flex-wrap gap-2">
        {u.role === 'admin' ? (
          <button className="btn-secondary" disabled={Boolean(locked)} title={locked || 'They can no longer open the admin panel'}
            onClick={() => setDialog('demote')}><ShieldOff className="h-4 w-4" /> Remove admin</button>
        ) : (
          <button className="btn-secondary" disabled={u.suspended} title={u.suspended ? 'Lift the suspension first' : 'Let them open the admin panel'}
            onClick={() => setDialog('promote')}><ShieldCheck className="h-4 w-4" /> Make admin</button>
        )}
        {u.suspended ? (
          <button className="btn-secondary" disabled={Boolean(locked)} title={locked || undefined}
            onClick={() => setDialog('unsuspend')}><CircleCheck className="h-4 w-4" /> Lift suspension</button>
        ) : (
          <button className="btn-secondary" disabled={Boolean(locked)} title={locked || 'Stop them signing in and using the app'}
            onClick={() => setDialog('suspend')}><Ban className="h-4 w-4" /> Suspend</button>
        )}
        <button className="btn-secondary" onClick={() => setDialog('quota')}><HardDrive className="h-4 w-4" /> Storage limit</button>
        <button className="btn-secondary" disabled={Boolean(locked)} title={locked || 'Give them a temporary password'}
          onClick={() => setDialog('password')}><KeyRound className="h-4 w-4" /> Reset password</button>
        <button className="btn-secondary" disabled={Boolean(locked)} title={locked || 'End their sessions on every device'}
          onClick={() => setDialog('signout')}><LogOut className="h-4 w-4" /> Sign out everywhere</button>
        <button className="btn-ghost text-danger hover:bg-danger-soft hover:text-danger sm:ml-auto" disabled={Boolean(locked)}
          title={locked || undefined} onClick={() => setDialog('delete')}><Trash2 className="h-4 w-4" /> Delete account</button>
      </div>

      {u.suspended && (
        <div className="mt-4 flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm">
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>Suspended {u.suspended_at ? formatRelative(u.suspended_at * 1000) : ''}. They can’t sign in, and their links still work
            until you turn them off below.</span>
        </div>
      )}

      {/* Numbers */}
      <Dimmed when={loading}>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="panel px-4 py-3.5">
            <div className="flex items-center gap-1.5 text-xs text-muted"><HardDrive className="h-3.5 w-3.5" /> Storage</div>
            <div className="mt-1.5 text-2xl font-semibold tracking-tight">{formatBytes(u.used_bytes)}</div>
            <div className="mt-0.5 text-xs text-muted">
              {u.quota_bytes ? `of ${formatBytes(u.quota_bytes)}` : 'No limit'}{u.custom_quota ? ' · own limit' : ''}
            </div>
            {u.quota_bytes > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className={`h-full rounded-full ${quotaTone(pct) === 'danger' ? 'bg-danger' : quotaTone(pct) === 'warning' ? 'bg-amber-500' : 'bg-accent'}`}
                  style={{ width: `${Math.min(100, Math.max(u.used_bytes ? 1 : 0, pct))}%` }} />
              </div>
            )}
          </div>
          <StatTile icon={Files} label="Files" value={formatCount(u.file_count)}
            sub={u.uploading_count ? `${u.uploading_count} uploading` : plural(u.downloads, 'download')} />
          <StatTile icon={Link2} label="Active links" value={formatCount(u.active_links)} sub={`of ${plural(u.link_count, 'link')} made`} />
          <StatTile icon={History} label="Last sign-in"
            value={u.last_login_at ? formatRelative(u.last_login_at * 1000) : 'Never'}
            sub={`${plural(u.login_count, 'sign-in')} · joined ${u.created_at ? formatDate(u.created_at * 1000) : '—'}`} />
        </div>

        {/* Tabs */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <Segmented label="Show" value={tab} onChange={setTab} options={[
            { value: 'files', label: `Files (${data.files.length})` },
            { value: 'links', label: `Links (${data.links.length})` },
            { value: 'activity', label: 'Activity' },
          ]} />
        </div>
        <div className="panel mt-3 overflow-hidden">
          {tab === 'files' && (data.files.length
            ? <FileTable files={data.files} token={token} onChanged={reload} showOwner={false} />
            : <EmptyState icon={Files} title="No files">{name} hasn’t uploaded anything yet.</EmptyState>)}
          {tab === 'links' && (data.links.length
            ? <LinkTable links={data.links} token={token} onChanged={reload} showOwner={false} />
            : <EmptyState icon={Link2} title="No links">{name} hasn’t shared anything yet.</EmptyState>)}
          {tab === 'activity' && (data.activity.length
            ? <ActivityList events={data.activity} />
            : <EmptyState icon={History} title="No activity yet" />)}
        </div>
      </Dimmed>

      {/* Dialogs */}
      {dialog === 'promote' && (
        <ConfirmDialog title={`Make ${name} an admin?`} confirmLabel="Make admin" confirmIcon={ShieldCheck}
          onClose={() => setDialog(null)} onConfirm={() => change({ role: 'admin' }, `${name} is now an admin.`)}>
          They’ll be able to see every account and file, change accounts, and delete anything. They’ll see the admin
          panel the next time their session renews (within an hour) or when they sign in again.
        </ConfirmDialog>
      )}
      {dialog === 'demote' && (
        <ConfirmDialog title={`Remove ${name}’s admin role?`} confirmLabel="Remove admin" confirmIcon={ShieldOff}
          onClose={() => setDialog(null)} onConfirm={() => change({ role: 'user' }, `${name} is no longer an admin.`)}>
          They lose access to the admin panel right away. Their own files and links aren’t affected.
        </ConfirmDialog>
      )}
      {dialog === 'suspend' && (
        <ConfirmDialog danger title={`Suspend ${name}?`} confirmLabel="Suspend" confirmIcon={Ban}
          onClose={() => setDialog(null)} onConfirm={() => change({ suspended: true }, `${name} is suspended.`)}>
          They’re signed out everywhere within a few minutes and can’t sign in again until you lift the suspension.
          Their files are kept, and links they already shared keep working unless you turn them off.
        </ConfirmDialog>
      )}
      {dialog === 'unsuspend' && (
        <ConfirmDialog title={`Lift ${name}’s suspension?`} confirmLabel="Lift suspension" confirmIcon={CircleCheck}
          onClose={() => setDialog(null)} onConfirm={() => change({ suspended: false }, `${name} can sign in again.`)}>
          They’ll be able to sign in and use DropVault again.
        </ConfirmDialog>
      )}
      {dialog === 'signout' && (
        <ConfirmDialog title={`Sign ${name} out everywhere?`} confirmLabel="Sign out" confirmIcon={LogOut}
          onClose={() => setDialog(null)}
          onConfirm={() => run('signout', () => adminApi.signOutUser(u.user_id, token), `${name} is signed out everywhere.`).then(reload)}>
          Every session on every device ends within a few minutes. They can sign in again with their password.
        </ConfirmDialog>
      )}
      {dialog === 'delete' && (
        <ConfirmDialog danger title={`Delete ${name}’s account?`} confirmLabel="Delete account" confirmIcon={Trash2}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await run('delete', () => adminApi.deleteUser(u.user_id, token), `Deleted ${name}’s account.`);
            navigate('/admin/users');
          }}>
          The account, its {plural(u.file_count + u.uploading_count, 'file')} ({formatBytes(u.used_bytes)}) and all its
          links are deleted for good. They aren’t told. This can’t be undone.
        </ConfirmDialog>
      )}
      {dialog === 'quota' && <QuotaDialog user={u} onClose={() => setDialog(null)} onSave={(q, msg) => change({ quota_bytes: q }, msg)} />}
      {dialog === 'password' && <PasswordDialog user={u} token={token} onClose={() => setDialog(null)} onDone={reload} />}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/admin/users" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
      <ArrowLeft className="h-4 w-4" /> All users
    </Link>
  );
}

function CopyId({ id }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch (err) { toast.error(err); }
  };
  return (
    <button onClick={copy} className="inline-flex items-center gap-1 font-mono text-xs hover:text-fg" title="Copy user ID">
      {id.slice(0, 8)}… {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function QuotaDialog({ user, onClose, onSave }) {
  const [choice, setChoice] = useState(() => {
    if (!user.custom_quota) return 'default';
    if (user.quota_bytes === 0) return 'unlimited';
    return QUOTA_CHOICES.includes(user.quota_bytes) ? String(user.quota_bytes) : 'custom';
  });
  // A custom limit is typed in MB or GB (limits under 1 GB start in MB, so they don't round away).
  const [unit, setUnit] = useState(() => (user.custom_quota && user.quota_bytes && user.quota_bytes < GB ? 'MB' : 'GB'));
  const [custom, setCustom] = useState(() => {
    if (!user.custom_quota || !user.quota_bytes) return '';
    return String(+(user.quota_bytes / (user.quota_bytes < GB ? MB : GB)).toFixed(2));
  });
  const [busy, setBusy] = useState(false);
  const name = user.name || user.email;

  const value = () => {
    if (choice === 'default') return null;
    if (choice === 'unlimited') return 0;
    if (choice === 'custom') return Math.round(Number(custom) * (unit === 'MB' ? MB : GB));
    return Number(choice);
  };
  const customInvalid = choice === 'custom' && !(Number(custom) > 0 && Number(custom) * (unit === 'MB' ? MB : GB) <= 1024 ** 5);
  const next = value();
  const below = next && next < user.used_bytes;

  const save = async () => {
    setBusy(true);
    const label = next === null ? 'the default' : next === 0 ? 'unlimited' : formatBytes(next);
    try {
      await onSave(next, `${name}’s storage limit is now ${label}.`);
      onClose();
    } catch { setBusy(false); }
  };

  return (
    <Modal onClose={busy ? () => {} : onClose} title="Storage limit" icon={HardDrive}
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={busy || customInvalid}>{busy ? <Spinner /> : 'Save'}</button>
      </>}>
      <p className="text-sm text-muted">
        <span className="font-medium text-fg">{name}</span> uses {formatBytes(user.used_bytes)}.
      </p>
      <label className="label mt-4" htmlFor="quota-choice">Limit</label>
      <select id="quota-choice" className="input h-9" value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="default">Default for everyone</option>
        {QUOTA_CHOICES.map((q) => <option key={q} value={String(q)}>{formatBytes(q)}</option>)}
        <option value="unlimited">No limit</option>
        <option value="custom">Custom…</option>
      </select>
      {choice === 'custom' && (
        <div className="mt-3">
          <label className="label" htmlFor="quota-custom">Custom limit</label>
          <div className="flex gap-2">
            <input id="quota-custom" className="input h-9" type="number" min="0.01" step="any" inputMode="decimal" autoFocus
              value={custom} onChange={(e) => setCustom(e.target.value)} />
            <select className="input h-9 w-24" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit">
              <option value="MB">MB</option>
              <option value="GB">GB</option>
            </select>
          </div>
        </div>
      )}
      <span className="hint">
        {below
          ? 'This is less than they already use: their files stay, but new uploads are refused until they free up space.'
          : 'Checked when an upload finishes. Changing it doesn’t delete anything.'}
      </span>
    </Modal>
  );
}

function PasswordDialog({ user, token, onClose, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState(null);
  const [copied, setCopied] = useState(false);
  const name = user.name || user.email;

  const reset = async () => {
    setBusy(true);
    try {
      const r = await adminApi.resetPassword(user.user_id, token);
      setPassword(r.temporary_password);
      onDone();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) { toast.error(err); }
  };

  return (
    <Modal onClose={busy ? () => {} : onClose} title="Reset password" icon={KeyRound}
      footer={password ? (
        <>
          <button className="btn-secondary" onClick={onClose}>Done</button>
          <button className="btn-primary" onClick={copy}>{copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy password</>}</button>
        </>
      ) : (
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={reset} disabled={busy}>{busy ? <Spinner /> : <><KeyRound className="h-4 w-4" /> Reset password</>}</button>
        </>
      )}>
      {password ? (
        <>
          <p className="text-sm text-muted">The new temporary password for <span className="font-medium text-fg">{name}</span>:</p>
          <input readOnly className="input mt-3 h-10 text-center font-mono text-base tracking-wider" value={password}
            onFocus={(e) => e.target.select()} aria-label="Temporary password" />
          <p className="hint">Give it to them privately. It’s shown only this once. They’re signed out everywhere and sign in with this password.</p>
        </>
      ) : (
        <p className="text-sm text-muted">
          <span className="font-medium text-fg">{name}</span> gets a new temporary password, shown to you once, and is signed out on every
          device. Their current password stops working.
        </p>
      )}
    </Modal>
  );
}
