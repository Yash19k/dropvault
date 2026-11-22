import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, Cloud, Laptop } from 'lucide-react';
import { GROUPS, LOCAL, PIPELINE } from './resources';
import { Files, kicker } from './parts';
import { useReducedMotion } from '../landing/motion';

// "The big picture" diagram: your computer on top (what Terraform and
// deploy.sh work from), your AWS account below (what they create).
// Select a resource to see its Terraform resource types and file.

const ALL = GROUPS.flatMap((g) => g.items);

export default function ResourceMap() {
  const [selected, setSelected] = useState('lambdas');
  const detailRef = useRef(null);
  const reduced = useReducedMotion();
  const item = ALL.find((i) => i.id === selected);

  // In the one-column layout the details sit far below the buttons, so bring them into view.
  const select = (id) => {
    setSelected(id);
    if (window.matchMedia('(max-width: 639px)').matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' }));
    }
  };

  return (
    <div className="panel overflow-hidden">
      {/* Your computer */}
      <div className="bg-surface-2/60 p-4 sm:p-5">
        <p className={`${kicker} flex items-center gap-1.5`}><Laptop className="h-3.5 w-3.5" /> Your computer</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {LOCAL.map((l) => (
            <li key={l.name} className="rounded-md border border-line bg-surface px-3 py-2.5">
              <p className="flex items-center gap-2 font-mono text-[12.5px] font-medium text-fg">
                <l.icon className="h-3.5 w-3.5 shrink-0 text-accent" /> {l.name}
              </p>
              <p className="mt-1 text-[13px] leading-snug text-muted">{l.text}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-4">
          <p className={`${kicker} shrink-0`}>bash deploy.sh</p>
          <ol className="grid flex-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-4">
            {PIPELINE.map((s, k) => (
              <li key={s.name} className="grid grid-cols-[20px_1fr] gap-2 text-[13px] leading-snug">
                <span className="mt-px grid h-5 w-5 place-items-center rounded-full border border-accent font-mono text-[10.5px] text-accent">{k + 1}</span>
                <span><span className="font-mono font-medium text-fg">{s.name}</span> <span className="text-muted">{s.text}</span></span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* The arrow between them */}
      <div aria-hidden="true" className="flex items-center justify-center gap-2 border-y border-line bg-surface py-2 text-subtle">
        <ArrowDown className="h-3.5 w-3.5" />
        <span className="font-mono text-[10.5px] tracking-[0.12em]">AWS API CALLS<span className="hidden sm:inline"> · SIGNED WITH YOUR IAM USER’S KEYS</span></span>
        <ArrowDown className="h-3.5 w-3.5" />
      </div>

      {/* Your AWS account */}
      <div className="min-w-0 p-4 sm:p-5">
        <p className={`${kicker} flex items-center gap-1.5`}><Cloud className="h-3.5 w-3.5" /> Your AWS account · one region</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Resources Terraform creates">
          {GROUPS.map((g) => (
            <div key={g.name} className="rounded-lg border border-dashed border-line-strong p-2">
              <p className="px-1 pb-1.5 pt-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-subtle">{g.name}</p>
              <ul className="space-y-1.5">
                {g.items.map((i) => {
                  const on = i.id === selected;
                  return (
                    <li key={i.id}>
                      <button type="button" onClick={() => select(i.id)} aria-pressed={on}
                        className={`flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring ${
                          on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent'}`}>
                        <span className={`mt-px grid h-6 w-6 shrink-0 place-items-center rounded-[6px] ${on ? 'bg-surface' : 'bg-accent-soft'} text-accent`}>
                          <i.icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold leading-tight text-fg">{i.name}</span>
                          <span className="mt-0.5 block font-mono text-[11px] leading-tight text-muted">{i.count}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Details of the selected resource */}
      <div ref={detailRef} className="scroll-mt-32 border-t border-line p-5" aria-live="polite">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><item.icon className="h-4 w-4" /></span>
              {item.name}
            </h3>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">{item.text}</p>
            {item.notes.length > 0 && (
              <ul className="mt-3 space-y-2">
                {item.notes.map((n) => (
                  <li key={n} className="relative pl-4 text-sm leading-relaxed text-muted">
                    <span aria-hidden="true" className="absolute left-0.5 top-[0.6em] h-1.5 w-1.5 rounded-[2px] bg-accent" />
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="min-w-0">
            <p className={kicker}>Terraform resource types</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {item.types.map((t) => (
                <li key={t} className="rounded-md border border-line px-2 py-0.5 font-mono text-[11.5px] text-fg [overflow-wrap:anywhere]">{t}</li>
              ))}
            </ul>
            <p className={`${kicker} mt-4`}>Declared in</p>
            <Files paths={item.files} className="mt-2" />
            {item.hiw && (
              <Link to="/how-it-works" className="link mt-4 inline-flex items-center gap-1 text-sm">
                What it does at run time <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
