import { Link } from 'react-router-dom';
import { Logo } from './ui';
import { APP_TAGLINE } from '../brand';

export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link to="/"><Logo /></Link>
      </header>

      <main className="mx-auto flex max-w-md flex-col px-5 py-10 sm:py-16">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
          <p className="mt-1.5 text-sm text-slate-400">{subtitle || APP_TAGLINE}</p>
        </div>
        <div className="card p-7">{children}</div>
      </main>
    </div>
  );
}
