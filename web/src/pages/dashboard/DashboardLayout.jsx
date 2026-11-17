import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Files as FilesIcon, LogOut, Menu, X } from 'lucide-react';
import { Logo } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';

const nav = [{ to: '/app', end: true, icon: FilesIcon, label: 'My Files' }];

export default function DashboardLayout() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    toast.success('Signed out.');
    navigate('/login');
  };

  const SidebarBody = (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5"><Logo /></div>
      <nav className="flex-1 space-y-1 px-3">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
            className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              isActive ? 'bg-brand-600/15 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}>
            <n.icon className="h-4.5 w-4.5" /> {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-1 border-t border-white/5 p-3">
        <div className="truncate px-3 py-1 text-xs text-slate-500" title={session?.email}>{session?.email}</div>
        <button onClick={handleSignOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-rose-400 hover:bg-rose-500/10">
          <LogOut className="h-4.5 w-4.5" /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-white/5 bg-slate-950/40 lg:block">{SidebarBody}</aside>

      <header className="flex items-center justify-between border-b border-white/5 px-4 py-3 lg:hidden">
        <Logo />
        <button onClick={() => setOpen(true)} className="btn-ghost"><Menu className="h-5 w-5" /></button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 border-r border-white/10 bg-slate-950">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
            {SidebarBody}
          </div>
        </div>
      )}

      <main className="min-w-0 px-5 py-8 sm:px-8 lg:py-10">
        <div className="mx-auto max-w-5xl"><Outlet /></div>
      </main>
    </div>
  );
}
