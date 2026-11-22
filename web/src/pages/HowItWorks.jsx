import { Link } from 'react-router-dom';
import { ArrowRight, Github } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { APP_NAME, REPO_URL } from '../brand';
import { SiteFooter, SiteHeader, usePageScroll, usePageTitle } from './landing/SiteChrome';
import Explorer from './how-it-works/Explorer';
import { FACTS } from './how-it-works/architecture';

// /how-it-works: how DropVault is built, as an interactive architecture diagram.

export default function HowItWorks() {
  const { isAuthenticated } = useAuth();
  usePageScroll();
  usePageTitle(`How it works - ${APP_NAME}`);

  return (
    <div className="min-h-screen overflow-x-clip">
      <SiteHeader />

      <main>
        <section className="relative isolate border-b border-line">
          <div aria-hidden="true" className="bg-grid mask-fade-b absolute inset-0 -z-10 opacity-70" />
          <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 pb-12 pt-14 sm:pt-20 lg:flex-row lg:items-end lg:justify-between lg:pb-14">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent">How it works</p>
              <h1 className="mt-4 text-[2.4rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl lg:text-[3.3rem]">
                No servers. Just AWS, each part doing one job.
              </h1>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted">
                {APP_NAME} runs entirely on managed AWS services, all created by Terraform. Select any part of the diagram
                to see what it does, or pick a request and watch it move through the stack.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-y-5 border-t border-line pt-4 sm:grid-cols-4 lg:min-w-[440px]">
              {FACTS.map((f, k) => (
                <div key={f.label} className={`border-line pr-4 ${k % 2 ? 'border-l pl-4' : ''} ${k === 2 ? 'sm:border-l sm:pl-4' : ''}`}>
                  <dt className="text-2xl font-semibold tracking-tight tabular-nums">{f.value}</dt>
                  <dd className="mt-0.5 text-[13px] leading-snug text-muted">{f.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-10 lg:py-14">
          <Explorer />
        </section>

        <section className="border-t border-line bg-surface/70">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-12 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {isAuthenticated ? 'Your files are waiting.' : 'See it working.'}
              </h2>
              <p className="mt-1.5 text-muted">
                {isAuthenticated
                  ? 'Everything above is what runs when you upload or share.'
                  : 'Send your first file, or deploy your own copy with one command.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to={isAuthenticated ? '/app' : '/signup'} className="btn-primary group h-11 px-5 text-[15px]">
                {isAuthenticated ? 'Go to your files' : 'Create a free account'}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="btn-secondary h-11 px-5 text-[15px]">
                <Github className="h-4 w-4" /> View the source
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
