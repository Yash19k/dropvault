import { Link } from 'react-router-dom';
import { Logo } from './ui';
import { ThemeToggle } from '../theme';

export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-between px-5 sm:px-8">
        <Link to="/" aria-label="DropVault home"><Logo /></Link>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 justify-center px-5 pb-16 pt-8 sm:pt-20">
        <div className="w-full max-w-[380px]">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="panel mt-7 p-6 shadow-sm">{children}</div>
          {footer && <p className="mt-5 text-center text-sm text-muted">{footer}</p>}
        </div>
      </main>
    </div>
  );
}
