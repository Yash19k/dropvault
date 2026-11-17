import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { FolderClosed, LogOut, Menu, X } from 'lucide-react';
import { Logo } from '../../components/ui';
import { ThemeToggle } from '../../theme';
import { useAuth } from '../../context/AuthContext';

const nav = [{ to: '/app', end: true, icon: FolderClosed, label: 'All files' }];

function initials(name, email) {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (name ? parts[1]?.[0] || '' : '')).toUpperCase() || '?';
}

export default function DashboardLayout() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b border-line px-4">
        <Link to="/" aria-label="DropVault home"><Logo /></Link>
      </div>

      <nav className="flex-1 space-y-0.5 p-3" aria-label="Main">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
            className={({ isActive }) => `flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors ${
              isActive ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}`}>
            <n.icon className="h-4 w-4" /> {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-3 border-t border-line p-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted">Theme</span>
          <ThemeToggle />
        </div>
        <div className="flex items-center gap-2.5 rounded-md p-1">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
            {initials(session?.name, session?.email)}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            {session?.name && <div className="truncate text-sm font-medium">{session.name}</div>}
            <div className="truncate text-xs text-muted" title={session?.email}>{session?.email}</div>
          </div>
          <button onClick={handleSignOut} className="btn-icon" title="Sign out" aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface lg:block">{sidebar}</aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
        <Link to="/" aria-label="DropVault home"><Logo /></Link>
        <button onClick={() => setOpen(true)} className="btn-icon" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 max-w-[85vw] border-r border-line bg-surface shadow-lg">
            <button onClick={() => setOpen(false)} className="btn-icon absolute right-2 top-3" aria-label="Close menu">
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <main className="min-w-0 px-4 py-6 sm:px-8 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-5xl"><Outlet /></div>
      </main>
    </div>
  );
}
