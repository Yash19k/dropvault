import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Github } from 'lucide-react';
import { Logo } from '../../components/ui';
import { ThemeToggle } from '../../theme';
import { useAuth } from '../../context/AuthContext';
import { APP_NAME, REPO_URL } from '../../brand';

// Header and footer shared by the public pages (landing, how it works, deploy guide).

const NAV = 'transition-colors hover:text-fg aria-[current=page]:font-medium aria-[current=page]:text-fg';

export function SiteHeader() {
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const onHome = pathname === '/';
  // Landing sections are plain anchors on the landing page and links back to it elsewhere.
  const section = (hash, label) => (onHome
    ? <a href={hash} className={NAV}>{label}</a>
    : <Link to={`/${hash}`} className={NAV}>{label}</Link>);

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/75 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link to="/" aria-label={`${APP_NAME} home`}><Logo /></Link>
        <nav className="hidden items-center gap-7 text-sm text-muted md:flex" aria-label="Site">
          {section('#features', 'Features')}
          {section('#lifetime', 'How links end')}
          <Link to="/how-it-works" className={NAV} aria-current={pathname === '/how-it-works' ? 'page' : undefined}>How it works</Link>
          <Link to="/deploy" className={NAV} aria-current={pathname === '/deploy' ? 'page' : undefined}>Deploy</Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={NAV}>GitHub</a>
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:block"><ThemeToggle /></div>
          {isAuthenticated ? (
            <Link to="/app" className="btn-primary">Open app <ArrowRight className="h-4 w-4" /></Link>
          ) : (
            <>
              <Link to="/login" className="btn-ghost">Sign in</Link>
              <Link to="/signup" className="btn-primary">Get started</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-subtle">© {new Date().getFullYear()}</span>
        </div>
        <div className="flex items-center gap-5">
          <div className="sm:hidden"><ThemeToggle /></div>
          <Link to="/how-it-works" className="hover:text-fg">How it works</Link>
          <Link to="/deploy" className="hover:text-fg">Deploy guide</Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-fg">
            <Github className="h-4 w-4" /> Source on GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

// Moving between public pages: open at the #section in the URL, or at the top.
export function usePageScroll() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const el = hash && document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
}

// Sets the browser tab title while a page is open.
export function usePageTitle(title) {
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => { document.title = before; };
  }, [title]);
}
