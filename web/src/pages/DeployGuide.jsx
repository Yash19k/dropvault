import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Check, ChevronDown, Github, ListChecks, MonitorSmartphone, Receipt, RotateCcw, Wrench,
} from 'lucide-react';
import { APP_NAME, REPO_URL } from '../brand';
import { SiteFooter, SiteHeader, usePageScroll, usePageTitle } from './landing/SiteChrome';
import { useReducedMotion } from './landing/motion';
import ResourceMap from './deploy-guide/ResourceMap';
import { Files, kicker, useProgress } from './deploy-guide/parts';
import {
  BeforeYouStart, CONCEPTS, Costs, STEPS, Teardown, Troubleshooting, Updating,
} from './deploy-guide/content';

// /deploy: how to deploy your own copy of DropVault to AWS with Terraform,
// step by step, with what each step teaches. Content lives in ./deploy-guide.

const stepAnchor = (id) => `step-${id}`;

const OVERVIEW = [
  { id: 'big-picture', label: 'The big picture' },
  { id: 'concepts', label: 'AWS concepts' },
  { id: 'before-you-start', label: 'Before you start' },
];
const AFTER = [
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'costs', label: 'Costs' },
  { id: 'updating', label: 'Updating' },
  { id: 'teardown', label: 'Teardown' },
];
const ALL_IDS = [...OVERVIEW.map((s) => s.id), ...STEPS.map((s) => stepAnchor(s.id)), ...AFTER.map((s) => s.id)];
const LABELS = Object.fromEntries([
  ...OVERVIEW.map((s) => [s.id, s.label]),
  ...STEPS.map((s, k) => [stepAnchor(s.id), `Step ${k + 1}: ${s.title}`]),
  ...AFTER.map((s) => [s.id, s.label]),
]);

// The section currently at the top of the screen, for the step list.
function useActiveSection() {
  const [active, setActive] = useState(ALL_IDS[0]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = ALL_IDS[0];
      for (const id of ALL_IDS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 140) current = id;
      }
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return active;
}

export default function DeployGuide() {
  usePageScroll();
  usePageTitle(`Deploy guide - ${APP_NAME}`);
  const { done, toggle, reset } = useProgress();
  const active = useActiveSection();
  const reduced = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const doneCount = STEPS.filter((s) => done.includes(s.id)).length;

  const jump = useCallback((e, id) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    // Close the phone menu first: it sits in the page flow, so the target moves once it collapses.
    setMenuOpen(false);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }));
    try { window.history.replaceState(window.history.state, '', `#${id}`); } catch { /* ignore */ }
  }, [reduced]);

  const nav = <StepNav active={active} done={done} onJump={jump} />;

  return (
    <div className="min-h-screen overflow-x-clip">
      <SiteHeader />

      <main>
        <section className="relative isolate border-b border-line">
          <div aria-hidden="true" className="bg-grid mask-fade-b absolute inset-0 -z-10 opacity-70" />
          <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 pb-12 pt-14 sm:pt-20 lg:flex-row lg:items-end lg:justify-between lg:pb-14">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-accent">Deploy guide</p>
              <h1 className="mt-4 text-[2.4rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl lg:text-[3.3rem]">
                Run your own {APP_NAME} on AWS.
              </h1>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted">
                From an empty AWS account to your own copy, built by Terraform from the code in the repository. Every step
                says what you’re doing and what it teaches you about AWS. <Link to="/how-it-works" className="link">How it works</Link> shows
                what the parts do; this page is about creating them.
              </p>
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted">
                <li className="inline-flex items-center gap-1.5"><MonitorSmartphone className="h-3.5 w-3.5 text-subtle" /> Windows · PowerShell and Git Bash</li>
                <li className="inline-flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5 text-subtle" /> Terraform 1.5 or newer</li>
                <li className="inline-flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5 text-subtle" /> About $0 to $1 a month at demo scale</li>
              </ul>
            </div>
            <ProgressCard count={doneCount} total={STEPS.length} onReset={reset} />
          </div>
        </section>

        {/* Step list for small screens: a bar under the header that opens the list */}
        <div className="sticky top-16 z-30 border-b border-line bg-canvas/90 backdrop-blur-md lg:hidden">
          <div className="mx-auto max-w-6xl px-5">
            <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-controls="deploy-mobile-nav"
              className="flex h-12 w-full items-center justify-between gap-3 text-left text-sm focus-visible:outline-none">
              <span className="flex min-w-0 items-center gap-2">
                <ListChecks className="h-4 w-4 shrink-0 text-accent" />
                <span className="truncate font-medium text-fg">{LABELS[active]}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-xs tabular-nums text-subtle">
                {doneCount}/{STEPS.length}
                <ChevronDown className={`h-4 w-4 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>
            {menuOpen && (
              <div id="deploy-mobile-nav" className="max-h-[65vh] overflow-y-auto border-t border-line pb-4 pt-3">{nav}</div>
            )}
          </div>
        </div>

        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:py-14">
          <aside className="hidden lg:block">
            <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-6 pr-2">{nav}</div>
          </aside>

          <div className="min-w-0">
            <Section id="big-picture" kicker="Overview" title="The big picture"
              intro={<>
                <C2>deploy.sh</C2> runs on your computer and talks to the AWS API with your IAM user’s keys. Terraform creates
                everything in the lower half; then the script builds the web app and publishes it. Select a resource to see
                which Terraform types make it and where they’re declared.
              </>}>
              <ResourceMap />
            </Section>

            <Section id="concepts" kicker="Overview" title="AWS concepts you’ll meet"
              intro="What each service is, and how this stack uses it. Each card links to the Terraform that sets it up.">
              <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
                {CONCEPTS.map((c) => (
                  <div key={c.title} className="flex flex-col bg-surface p-5">
                    <c.icon className="h-5 w-5 text-accent" />
                    <h3 className="mt-3 text-[15px] font-semibold">{c.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{c.text}</p>
                    <ul className="mt-3 space-y-2">
                      {c.points.map((p) => (
                        <li key={p} className="relative pl-4 text-sm leading-relaxed text-muted">
                          <span aria-hidden="true" className="absolute left-0.5 top-[0.6em] h-1.5 w-1.5 rounded-[2px] bg-accent" />
                          {p}
                        </li>
                      ))}
                    </ul>
                    <Files paths={c.files} className="mt-auto pt-4" />
                  </div>
                ))}
              </div>
            </Section>

            <Section id="before-you-start" kicker="Overview" title="Before you start">
              <div className="max-w-3xl"><BeforeYouStart /></div>
            </Section>

            <div className="mt-16">
              <p className={kicker}>Steps</p>
              <h2 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Deploy it, one step at a time</h2>
              <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-muted">
                Tick each step when it’s done. Your progress is kept in this browser, so you can stop and come back.
              </p>
              <ol className="mt-6 space-y-5">
                {STEPS.map((s, k) => (
                  <StepCard key={s.id} step={s} n={k + 1} total={STEPS.length}
                    done={done.includes(s.id)} onToggle={() => toggle(s.id)} />
                ))}
              </ol>
            </div>

            <Section id="troubleshooting" kicker="After deploying" title="Troubleshooting"
              intro="The problems you’re most likely to hit, and what causes them. Select one to open it.">
              <Troubleshooting />
            </Section>

            <Section id="costs" kicker="After deploying" title="What it costs">
              <div className="max-w-3xl"><Costs /></div>
            </Section>

            <Section id="updating" kicker="After deploying" title="Updating your copy">
              <div className="max-w-3xl"><Updating /></div>
            </Section>

            <Section id="teardown" kicker="After deploying" title="Tearing it all down">
              <div className="max-w-3xl"><Teardown /></div>
            </Section>
          </div>
        </div>

        <section className="border-t border-line bg-surface/70">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-12 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Now see what you built.</h2>
              <p className="mt-1.5 text-muted">Follow an upload or a share link through the stack you just deployed.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to="/how-it-works" className="btn-primary group h-11 px-5 text-[15px]">
                How it works
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

// Inline code in the page's own copy (the content file has its own).
function C2({ children }) {
  return <code className="rounded-[4px] border border-line bg-surface-2 px-1 py-px font-mono text-[0.84em] text-fg">{children}</code>;
}

function Section({ id, kicker: k, title, intro, children }) {
  return (
    <section id={id} className="scroll-mt-32 pt-16 first:pt-0 lg:scroll-mt-24">
      <p className={kicker}>{k}</p>
      <h2 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{title}</h2>
      {intro && <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-muted">{intro}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function ProgressCard({ count, total, onReset }) {
  const [asking, setAsking] = useState(false);
  const pct = Math.round((count / total) * 100);
  return (
    <div className="panel w-full p-5 sm:max-w-sm lg:w-[320px]">
      <p className={kicker}>Your progress</p>
      <p className="mt-2 text-[15px] text-fg">
        <span className="font-semibold tabular-nums">{count}</span> of {total} steps done
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar"
        aria-valuemin={0} aria-valuemax={total} aria-valuenow={count} aria-label="Steps done">
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 flex min-h-8 items-center justify-between gap-3 text-[13px] text-subtle">
        {asking ? (
          <>
            <span>Clear every tick?</span>
            <span className="flex gap-1.5">
              <button type="button" className="btn-ghost h-8 px-2.5 text-[13px]" onClick={() => setAsking(false)}>Keep</button>
              <button type="button" className="btn-secondary h-8 px-2.5 text-[13px]" onClick={() => { onReset(); setAsking(false); }}>Clear</button>
            </span>
          </>
        ) : (
          <>
            <span>Saved in this browser.</span>
            {count > 0 && (
              <button type="button" onClick={() => setAsking(true)}
                className="inline-flex items-center gap-1.5 rounded-sm transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring">
                <RotateCcw className="h-3.5 w-3.5" /> Start over
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const navLink = 'block rounded-md border-l-2 py-1.5 pl-3 pr-2 text-[13.5px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring';

function NavGroup({ title, children }) {
  return (
    <div className="mb-5 last:mb-0">
      <p className={`${kicker} mb-1.5`}>{title}</p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function StepNav({ active, done, onJump }) {
  const plain = (s) => {
    const on = active === s.id;
    return (
      <li key={s.id}>
        <a href={`#${s.id}`} onClick={(e) => onJump(e, s.id)} aria-current={on ? 'location' : undefined}
          className={`${navLink} ${on ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
          {s.label}
        </a>
      </li>
    );
  };
  return (
    <nav aria-label="Deploy guide">
      <NavGroup title="Overview">{OVERVIEW.map(plain)}</NavGroup>
      <NavGroup title="Steps">
        {STEPS.map((s, k) => {
          const id = stepAnchor(s.id);
          const on = active === id;
          const isDone = done.includes(s.id);
          return (
            <li key={s.id}>
              <a href={`#${id}`} onClick={(e) => onJump(e, id)} aria-current={on ? 'location' : undefined}
                className={`${navLink} grid grid-cols-[18px_1fr] items-start gap-2 ${on ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
                <span className={`mt-px grid h-[18px] w-[18px] place-items-center rounded-full border font-mono text-[10px] ${
                  isDone ? 'border-accent bg-accent text-accent-fg' : on ? 'border-accent text-accent' : 'border-line-strong text-subtle'}`}>
                  {isDone ? <Check className="h-3 w-3" strokeWidth={3} /> : k + 1}
                </span>
                <span>{s.title}<span className="sr-only">{isDone ? ' (done)' : ''}</span></span>
              </a>
            </li>
          );
        })}
      </NavGroup>
      <NavGroup title="After deploying">{AFTER.map(plain)}</NavGroup>
    </nav>
  );
}

function StepCard({ step, n, total, done, onToggle }) {
  const id = stepAnchor(step.id);
  return (
    <li id={id} className="panel scroll-mt-32 overflow-hidden lg:scroll-mt-24">
      <div className={`flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 ${done ? 'bg-accent-soft/60' : ''}`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border font-mono text-[13px] ${
            done ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong text-muted'}`}>
            {done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : n}
          </span>
          <div className="min-w-0">
            <p className={kicker}>Step {n} of {total}</p>
            <h3 className="mt-0.5 text-lg font-semibold leading-snug tracking-tight">{step.title}</h3>
          </div>
        </div>
        <label className={`mt-1 inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-2 rounded-md border px-2.5 text-[13px] font-medium transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring ${
          done ? 'border-accent bg-surface text-accent' : 'border-line-strong bg-surface text-muted hover:text-fg'}`}>
          <input type="checkbox" className="sr-only" checked={done} onChange={onToggle}
            aria-label={`Step ${n}, ${step.title}: done`} />
          <span aria-hidden="true" className={`grid h-4 w-4 place-items-center rounded-[4px] border ${
            done ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong bg-surface'}`}>
            {done && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
          Done
        </label>
      </div>
      <div className="max-w-3xl px-5 py-5 sm:px-6">{step.body}</div>
    </li>
  );
}
