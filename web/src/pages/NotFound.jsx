import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { APP_NAME } from '../brand';
import { SiteFooter, SiteHeader, usePageTitle } from './landing/SiteChrome';

// Any address the app has no page for.

export default function NotFound() {
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  usePageTitle(`Page not found - ${APP_NAME}`);

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <SiteHeader />

      <main className="relative isolate flex flex-1 items-center">
        <div aria-hidden="true" className="bg-grid mask-fade-b absolute inset-0 -z-10 opacity-70" />
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:py-28">
          <div className="max-w-xl animate-step-in motion-reduce:animate-none">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent">Error 404</p>
            <h1 className="mt-4 text-[2.4rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
              This page doesn't exist.
            </h1>
            <p className="mt-5 text-[17px] leading-relaxed text-muted">
              There is nothing at{' '}
              <code className="break-all rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[14px] text-fg">{pathname}</code>.
              The address may be mistyped, or the page may have moved.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/" className="btn-primary"><ArrowLeft className="h-4 w-4" /> Back to the home page</Link>
              {isAuthenticated
                ? <Link to="/app" className="btn-secondary">Open your files <ArrowRight className="h-4 w-4" /></Link>
                : <Link to="/how-it-works" className="btn-secondary">How it works</Link>}
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
