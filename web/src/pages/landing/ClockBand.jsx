import { useRef, useState } from 'react';
import { Clock, Download, Link2Off, TimerOff } from 'lucide-react';
import { Reveal, useInView, useInterval, useReducedMotion } from './motion';

// Full-width statement band: a real one-hour countdown (the default link
// lifetime) that starts when the section scrolls into view.

const ENDS = [
  { icon: Clock, title: 'On time', text: 'After 15 minutes, an hour, 6 hours, a day or 7 days. Or never.' },
  { icon: Download, title: 'On count', text: 'After 1, 3, 5, 10 or 25 downloads, if you set a limit.' },
  { icon: Link2Off, title: 'On demand', text: 'Turn off one link, or every link to a file, whenever you want.' },
  { icon: TimerOff, title: 'Clearly', text: 'A dead link shows a page that says what happened, not a storage error.' },
];

export default function ClockBand() {
  const ref = useRef(null);
  const started = useInView(ref, { once: true });
  const visible = useInView(ref);
  const reduced = useReducedMotion();
  const [left, setLeft] = useState(3600);
  useInterval(() => setLeft((s) => (s > 0 ? s - 1 : 3600)), 1000, started && visible && !reduced);

  const h = String(Math.floor(left / 3600)).padStart(2, '0');
  const m = String(Math.floor((left % 3600) / 60)).padStart(2, '0');
  const s = String(left % 60).padStart(2, '0');

  return (
    <section ref={ref} className="relative isolate overflow-hidden bg-band text-band-fg">
      <div aria-hidden="true" className="bg-grid-band mask-fade-c absolute inset-0 -z-10 opacity-70" />
      <div aria-hidden="true" className="absolute left-1/2 top-0 -z-10 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(111_216_196/0.22),transparent)] blur-2xl" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-linear-to-b from-transparent to-band-2" />

      <div className="mx-auto max-w-6xl px-5 py-20 text-center lg:py-28">
        <Reveal as="p" className="font-mono text-xs uppercase tracking-[0.16em] text-band-accent">Every link gets a clock</Reveal>
        <Reveal delay={80}>
          <div className="mt-6 font-mono text-[clamp(3.25rem,13vw,8.5rem)] font-medium leading-none tracking-tight tabular-nums"
            role="timer" aria-label="One hour, counting down">
            {h}<span className="text-band-muted">:</span>{m}<span className="text-band-muted">:</span>{s}
          </div>
          <div className="mx-auto mt-6 h-1 max-w-md overflow-hidden rounded-full bg-band-line">
            <div className="h-full origin-left rounded-full bg-band-accent transition-transform duration-1000 ease-linear"
              style={{ transform: `scaleX(${left / 3600})` }} />
          </div>
        </Reveal>
        <Reveal as="h2" delay={140} className="mx-auto mt-10 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          A shared link shouldn’t outlive its job.
        </Reveal>
        <Reveal as="p" delay={180} className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-band-muted">
          Most file links stay live for years after anyone needs them. Here, an hour is the default, and you decide how each one ends.
        </Reveal>

        <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-band-line bg-band-line text-left sm:grid-cols-2 lg:grid-cols-4">
          {ENDS.map((e, k) => (
            <Reveal key={e.title} delay={k * 70} className="bg-band/95 p-6 backdrop-blur">
              <e.icon className="h-5 w-5 text-band-accent" />
              <h3 className="mt-4 text-[15px] font-semibold">Ends {e.title.toLowerCase()}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-band-muted">{e.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
