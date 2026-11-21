import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Logo } from './ui';
import { ThemeToggle } from '../theme';
import { APP_NAME } from '../brand';
import HeroDemo from '../pages/landing/HeroDemo';

// Split layout for sign-in and sign-up: the form on the left over the
// landing page's grid, and on wide screens a deep-teal panel on the right
// with the same live product demo as the landing hero.
export default function AuthShell({ eyebrow, title, subtitle, children, footer, aside }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="relative isolate flex min-h-screen flex-col">
        <div aria-hidden="true" className="bg-grid mask-fade-b absolute inset-0 -z-10 opacity-70" />
        <div aria-hidden="true" className="glow pointer-events-none absolute -left-40 -top-40 -z-10 h-[520px] w-[520px] blur-2xl lg:hidden" />

        <header className="flex h-16 items-center justify-between px-5 sm:px-8">
          <Link to="/" aria-label={`${APP_NAME} home`}><Logo /></Link>
          <ThemeToggle />
        </header>

        <main className="flex flex-1 items-center justify-center px-5 pb-16 pt-6 sm:px-8">
          <div className="w-full max-w-[400px] animate-step-in motion-reduce:animate-none">
            {eyebrow && <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent">{eyebrow}</p>}
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.025em] sm:text-[2.1rem]">{title}</h1>
            {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-muted">{subtitle}</p>}
            <div className="mt-8">{children}</div>
            {footer && <p className="mt-8 border-t border-line pt-6 text-sm text-muted">{footer}</p>}
          </div>
        </main>
      </div>

      {aside && (
        <aside className="relative isolate hidden overflow-hidden bg-band text-band-fg lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
          <div aria-hidden="true" className="bg-grid-band mask-fade-c absolute inset-0 -z-10 opacity-70" />
          <div aria-hidden="true" className="absolute -right-40 -top-40 -z-10 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgb(111_216_196/0.22),transparent)] blur-2xl" />
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-linear-to-b from-transparent to-band-2" />

          <div className="flex flex-1 flex-col justify-center overflow-y-auto px-12 py-14 xl:px-16">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-band-accent">{aside.eyebrow}</p>
            <h2 className="mt-4 max-w-lg text-3xl font-semibold leading-tight tracking-[-0.025em] xl:text-4xl">{aside.title}</h2>
            {aside.text && <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-band-muted">{aside.text}</p>}
            {aside.points && (
              <ul className="mt-5 flex max-w-lg flex-wrap gap-x-6 gap-y-2 text-sm text-band-muted">
                {aside.points.map((p) => (
                  <li key={p} className="flex items-center gap-2"><Check className="h-4 w-4 text-band-accent" /> {p}</li>
                ))}
              </ul>
            )}
            {/* text-fg: the demo card uses page colours, not the band's light text */}
            <div className="mt-12 mb-14 w-full text-fg">
              <HeroDemo />
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
