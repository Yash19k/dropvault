import { Link } from 'react-router-dom';
import { ArrowRight, Github, RotateCcw, ShieldCheck, Scale } from 'lucide-react';
import { LogoMark } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { REPO_URL } from '../brand';
import { EMAIL_SHARING } from '../lib/features';
import HeroDemo from './landing/HeroDemo';
import Features from './landing/Features';
import ClockBand from './landing/ClockBand';
import { SiteFooter, SiteHeader, usePageScroll } from './landing/SiteChrome';
import { Reveal } from './landing/motion';

const STACK = ['Amazon S3', 'AWS Lambda', 'API Gateway', 'DynamoDB', 'KMS', 'SES', 'Terraform'];
const PROOF = [
  { icon: RotateCcw, text: 'Resumable uploads' },
  { icon: ShieldCheck, text: 'Encrypted at rest' },
  { icon: Scale, text: 'MIT licensed' },
];

export default function Landing() {
  const { isAuthenticated } = useAuth();
  usePageScroll();
  return (
    <div className="min-h-screen overflow-x-clip">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="relative isolate">
          <div aria-hidden="true" className="bg-grid mask-fade-b absolute inset-0 -z-10 opacity-70" />
          <div className="mx-auto grid max-w-6xl items-center gap-16 px-5 pb-28 pt-14 sm:pt-20 lg:grid-cols-[1fr_1.02fr] lg:gap-12 lg:pb-32 lg:pt-24">
            <div>
              <a href={REPO_URL} target="_blank" rel="noreferrer"
                className="group inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 py-1 pl-1 pr-3 text-xs text-muted shadow-xs backdrop-blur transition-colors hover:border-line-strong hover:text-fg">
                <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">Open source</span>
                Serverless file sharing on AWS
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </a>

              <h1 className="mt-6 max-w-xl text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl lg:text-[4.1rem]">
                Share files with links that{' '}
                <span className="relative inline-block whitespace-nowrap text-accent">
                  <span className="inline-block animate-expire-word motion-reduce:animate-none">expire.</span>
                  <span aria-hidden="true"
                    className="absolute -bottom-1.5 left-0 h-[0.085em] w-[calc(100%-0.3em)] origin-left animate-drain rounded-full bg-accent motion-reduce:animate-none" />
                </span>
              </h1>

              <p className="mt-7 max-w-lg text-lg leading-relaxed text-muted">
                Upload big files, send them by {EMAIL_SHARING ? 'email, link' : 'link'} or QR code, and decide how long each link works and how many
                downloads it gets. When it’s done, it’s gone.
              </p>

              <div className="mt-9 flex flex-wrap gap-3">
                {isAuthenticated ? (
                  <Link to="/app" className="btn-primary h-11 px-5 text-[15px] shadow-lg shadow-accent/25">
                    Go to your files <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <>
                    <Link to="/signup" className="btn-primary group h-11 px-5 text-[15px] shadow-lg shadow-accent/25">
                      Create a free account <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                    <Link to="/login" className="btn-secondary h-11 px-5 text-[15px]">Sign in</Link>
                  </>
                )}
              </div>

              <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
                {PROOF.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2"><Icon className="h-4 w-4 text-accent" /> {text}</li>
                ))}
              </ul>
            </div>

            <HeroDemo />
          </div>
        </section>

        {/* What it runs on */}
        <div className="border-y border-line bg-surface/70">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 py-6 md:flex-row md:justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-subtle">Runs serverless on</span>
            <ul className="flex flex-wrap justify-center gap-x-7 gap-y-2 text-sm font-medium text-muted">
              {STACK.map((s) => <li key={s}>{s}</li>)}
              <li>
                <Link to="/how-it-works" className="link inline-flex items-center gap-1">
                  How it works <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-16 px-5 py-20 lg:py-28">
          <Reveal className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent">Features</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Built for sending things, not storing them forever.
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">
              The parts that matter when you need to get a file to someone quickly and safely. Go on, click around.
            </p>
          </Reveal>
          <div className="mt-12">
            <Features />
          </div>
        </section>

        <div id="lifetime" className="scroll-mt-16">
          <ClockBand />
        </div>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
          <Reveal className="relative isolate overflow-hidden rounded-2xl bg-accent px-6 py-14 text-accent-fg shadow-lg sm:px-12 lg:py-16">
            <div aria-hidden="true"
              className="mask-fade-c absolute inset-0 -z-10 opacity-20 [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:44px_44px]" />
            <LogoMark className="pointer-events-none absolute -bottom-10 -right-8 -z-10 h-56 w-56 rotate-[-8deg] opacity-15 sm:h-72 sm:w-72" />
            <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
              <div className="max-w-xl">
                <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  {isAuthenticated ? 'Your files are waiting.' : 'Send your first file in under a minute.'}
                </h2>
                <p className="mt-3 text-[17px] opacity-80">
                  {isAuthenticated ? 'Upload something new or check who downloaded what.' : 'Name, email and a password. That’s the whole sign-up.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link to={isAuthenticated ? '/app' : '/signup'}
                  className="group inline-flex h-11 items-center gap-2 rounded-md bg-accent-fg px-5 text-[15px] font-medium text-accent shadow-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent-fg/40">
                  {isAuthenticated ? 'Go to your files' : 'Create a free account'}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <a href={REPO_URL} target="_blank" rel="noreferrer"
                  className="inline-flex h-11 items-center gap-2 rounded-md border border-current/30 px-5 text-[15px] font-medium transition-colors hover:bg-current/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent-fg/40">
                  <Github className="h-4 w-4" /> View the source
                </a>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
