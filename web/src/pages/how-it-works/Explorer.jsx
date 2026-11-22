import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Compass, Pause, Play, RotateCcw, X } from 'lucide-react';
import { REPO_URL } from '../../brand';
import { Reveal, useInView, useInterval, useReducedMotion } from '../landing/motion';
import {
  EDGES, FLOWS, LANES, LAYERS, NODES, NODE_H, NODE_W, PRINCIPLES, neighbors,
} from './architecture';

// The "How it works" page body: a clickable architecture diagram and the stack
// by layer. Hover or select a box to see what it does and what it talks to, or
// pick a request and step through it as it moves across the stack.
// Data lives in ./architecture.js.

const STEP_MS = 3200;
const EMPTY = { nodes: new Set(), edges: new Set() };

const repoLink = (p) => `${REPO_URL}/${/\.[a-z]+$/i.test(p) ? 'blob' : 'tree'}/main/${p}`;

export default function Explorer() {
  const [flowId, setFlowId] = useState(null);
  const [step, setStep] = useState(0);
  const [nodeId, setNodeId] = useState(null);
  const [hover, setHover] = useState(null);
  const [playing, setPlaying] = useState(false);
  const sectionRef = useRef(null);
  const diagramRef = useRef(null);
  const visible = useInView(sectionRef, { rootMargin: '0px' });
  const reduced = useReducedMotion();
  const flow = FLOWS.find((f) => f.id === flowId) || null;

  // Auto-advance a trace while it's playing and on screen.
  useInterval(() => {
    if (!flow) return;
    const next = Math.min(step + 1, flow.steps.length - 1);
    setStep(next);
    if (next >= flow.steps.length - 1) setPlaying(false);
  }, STEP_MS, playing && !!flow && visible);

  const lit = useMemo(() => {
    if (flow) {
      const s = flow.steps[step];
      return { nodes: new Set(s.nodes), edges: new Set(s.edges) };
    }
    const id = nodeId || hover;
    if (!id) return EMPTY;
    const nb = neighbors(id);
    return { nodes: new Set([id, ...nb.nodes]), edges: new Set(nb.edges) };
  }, [flow, step, nodeId, hover]);
  const focus = lit.nodes.size > 0;

  const reset = () => { setPlaying(false); setFlowId(null); setNodeId(null); setStep(0); };
  const pickFlow = (id) => {
    setNodeId(null); setHover(null); setStep(0);
    setFlowId(id);
    setPlaying(!!id);
  };
  const selectNode = (id) => {
    setPlaying(false); setFlowId(null); setHover(null);
    setNodeId(id);
  };
  const goTo = (k) => { setPlaying(false); setStep(k); };
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (flow && step >= flow.steps.length - 1) setStep(0);
    setPlaying(true);
  };
  const showInDiagram = (id) => {
    selectNode(id);
    diagramRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  };

  useEffect(() => {
    if (!flowId && !nodeId) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') reset(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flowId, nodeId]);

  return (
    <div ref={sectionRef}>
      <Reveal className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Diagram mode">
        <button type="button" className="chip h-9 gap-1.5 px-3 text-[13px]" aria-pressed={!flowId} onClick={() => pickFlow(null)}>
          <Compass className="h-3.5 w-3.5" /> Explore
        </button>
        <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-line-strong sm:block" />
        <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.14em] text-subtle">Trace</span>
        {FLOWS.map((f) => (
          <button key={f.id} type="button" className="chip h-9 gap-1.5 px-3 text-[13px]" aria-pressed={flowId === f.id}
            onClick={() => pickFlow(f.id)}>
            <f.icon className="h-3.5 w-3.5" /> {f.name}
          </button>
        ))}
      </Reveal>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Reveal className="panel min-w-0 p-2.5">
          <div ref={diagramRef} className="overflow-x-auto">
            <Diagram lit={lit} focus={focus} selected={flow ? null : nodeId}
              onSelect={(id) => (nodeId === id && !flow ? setNodeId(null) : selectNode(id))}
              onHover={(id) => { if (!flowId && !nodeId) setHover(id); }}
              onBackground={() => { if (nodeId) setNodeId(null); }} />
          </div>
          <p className="px-2 pb-1 pt-2 text-xs text-subtle md:hidden">Scroll sideways to see the whole diagram.</p>
        </Reveal>

        <Reveal delay={80} className="panel min-w-0 p-5 lg:sticky lg:top-20">
          <div aria-live="polite">
            {flow ? (
              <FlowPanel flow={flow} step={step} playing={playing} onStep={goTo} onTogglePlay={togglePlay} />
            ) : nodeId ? (
              <NodePanel id={nodeId} onSelect={selectNode} onClear={() => setNodeId(null)} />
            ) : (
              <StartPanel onPick={pickFlow} />
            )}
          </div>
        </Reveal>
      </div>

      <div className="mt-16">
        <Reveal className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-xl font-semibold tracking-tight">The stack, layer by layer</h3>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-sm">
            Read the code <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </Reveal>
        <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
          {LAYERS.map((L, k) => (
            <Reveal key={L.name} delay={k * 60} className="bg-surface p-5 sm:last:col-span-2 lg:last:col-span-1">
              <L.icon className="h-5 w-5 text-accent" />
              <h4 className="mt-3 text-[15px] font-semibold">{L.name}</h4>
              <ul className="mt-3 space-y-2">
                {L.tools.map((t) => (
                  <li key={t.name} className="flex items-baseline justify-between gap-3 text-sm">
                    {t.node ? (
                      <button type="button" onClick={() => showInDiagram(t.node)}
                        className="rounded-sm text-left font-medium underline decoration-line-strong underline-offset-4 transition-colors hover:text-accent hover:decoration-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring">
                        {t.name}
                      </button>
                    ) : (
                      <span className="font-medium">{t.name}</span>
                    )}
                    <span className="shrink-0 font-mono text-xs text-subtle">{t.version}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
        <p className="mt-3 text-xs text-subtle">Underlined names show their part in the diagram.</p>
      </div>
    </div>
  );
}

/* ---- Diagram ------------------------------------------------------------- */

function Diagram({ lit, focus, selected, onSelect, onHover, onBackground }) {
  return (
    <svg viewBox="0 0 990 600" className="block h-auto w-full min-w-[760px]" role="group"
      aria-label="DropVault architecture diagram"
      onClick={(e) => { if (!e.target.closest('[data-node]')) onBackground(); }}
      onMouseLeave={() => onHover(null)}>
      <defs>
        <marker id="hiw-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 1 L9 5 L0 9 z" className="fill-line-strong" />
        </marker>
        <marker id="hiw-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 1 L9 5 L0 9 z" className="fill-accent" />
        </marker>
      </defs>

      <g className={`transition-opacity duration-200 ${focus ? 'opacity-50' : ''}`}>
        {LANES.map((l) => (
          <text key={l.label} x={l.x} y="16" textAnchor="middle" className="fill-subtle font-mono text-[10.5px] tracking-[0.14em]">
            {l.label}
          </text>
        ))}
        <text x="10" y="567" className="fill-subtle font-mono text-[10.5px] tracking-[0.14em]">MONITORING</text>
        <rect x="385" y="26" width="170" height="396" rx="12" className="fill-none stroke-line-strong [stroke-dasharray:4_5]" />
      </g>

      {EDGES.map((e) => {
        const on = lit.edges.has(e.id);
        return (
          <g key={e.id} className={`transition-opacity duration-200 ${focus && !on ? 'opacity-15' : ''}`}>
            <path d={e.d} fill="none" markerEnd={on ? 'url(#hiw-arrow-on)' : 'url(#hiw-arrow)'}
              className={on
                ? 'animate-flow-dash stroke-accent [stroke-dasharray:6_5] [stroke-width:2] motion-reduce:animate-none motion-reduce:[stroke-dasharray:none]'
                : 'stroke-line-strong [stroke-width:1.4]'} />
            {e.label && (
              <text x={e.label.x} y={e.label.y} className={`font-mono text-[10.5px] ${on ? 'fill-accent' : 'fill-subtle'}`}>
                {e.label.text}
              </text>
            )}
          </g>
        );
      })}

      {Object.entries(NODES).map(([id, n]) => (
        <Node key={id} id={id} n={n} on={lit.nodes.has(id)} dim={focus && !lit.nodes.has(id)}
          selected={selected === id} onSelect={onSelect} onHover={onHover} />
      ))}
    </svg>
  );
}

function Node({ id, n, on, dim, selected, onSelect, onHover }) {
  const h = n.h || NODE_H;
  const Icon = n.icon;
  let box = 'fill-surface stroke-line-strong [stroke-width:1.2] group-hover:stroke-accent group-focus-visible:stroke-accent group-focus-visible:[stroke-width:2.5]';
  if (selected) box = 'fill-accent-soft stroke-accent [stroke-width:2.2]';
  else if (on) box = 'fill-surface stroke-accent [stroke-width:1.4]';
  return (
    <g data-node={id} role="button" tabIndex={0} aria-pressed={selected}
      aria-label={`${n.title}: ${n.sub.join(', ')}`}
      className={`group cursor-pointer outline-none transition-opacity duration-200 ${dim ? 'opacity-30' : ''}`}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); } }}
      onMouseEnter={() => onHover(id)}>
      <rect x={n.x} y={n.y} width={NODE_W} height={h} rx="10" className={`transition-colors duration-200 ${box}`} />
      <rect x={n.x + 10} y={n.y + 13} width="26" height="26" rx="7" className={selected ? 'fill-surface' : 'fill-accent-soft'} />
      <Icon x={n.x + 15} y={n.y + 18} size={16} className="text-accent" aria-hidden="true" />
      <text x={n.x + 45} y={n.y + 24} className="fill-fg text-[13px] font-semibold">{n.title}</text>
      {n.sub.map((s, k) => (
        <text key={s} x={n.x + 45} y={n.y + 40 + k * 14} className="fill-muted font-mono text-[11px]">{s}</text>
      ))}
    </g>
  );
}

/* ---- Side panel ---------------------------------------------------------- */

const kicker = 'font-mono text-[11px] uppercase tracking-[0.12em] text-subtle';

function PanelTitle({ icon: Icon, children }) {
  return (
    <h3 className="mt-1.5 flex items-center gap-2.5 text-lg font-semibold leading-snug tracking-tight">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
        <Icon className="h-4 w-4" />
      </span>
      {children}
    </h3>
  );
}

function Points({ items }) {
  return (
    <ul className="mt-3 space-y-2.5">
      {items.map((p) => (
        <li key={typeof p === 'string' ? p : p.title} className="relative pl-4 text-sm leading-relaxed text-muted">
          <span aria-hidden="true" className="absolute left-0.5 top-[0.6em] h-1.5 w-1.5 rounded-[2px] bg-accent" />
          {typeof p === 'string' ? p : <><span className="font-semibold text-fg">{p.title}</span> {p.text}</>}
        </li>
      ))}
    </ul>
  );
}

function StartPanel({ onPick }) {
  return (
    <>
      <p className={kicker}>Start here</p>
      <h3 className="mt-1.5 text-lg font-semibold leading-snug tracking-tight">Four choices shape this stack</h3>
      <Points items={PRINCIPLES} />
      <p className={`${kicker} mt-6`}>Try a request</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {FLOWS.slice(0, 3).map((f) => (
          <button key={f.id} type="button" className="chip gap-1.5" onClick={() => onPick(f.id)}>
            <f.icon className="h-3.5 w-3.5" /> {f.name}
          </button>
        ))}
      </div>
      <p className="mt-5 text-[13px] text-subtle">Hover a box to see what it talks to. Select it for details.</p>
    </>
  );
}

function NodePanel({ id, onSelect, onClear }) {
  const n = NODES[id];
  const linked = neighbors(id).nodes;
  return (
    <>
      <p className={kicker}>{n.tag}</p>
      <PanelTitle icon={n.icon}>{n.title}</PanelTitle>
      <p className="mt-3 text-sm leading-relaxed text-muted">{n.text}</p>
      {n.facts.length > 0 && <Points items={n.facts} />}
      {linked.length > 0 && (
        <>
          <p className={`${kicker} mt-5`}>Talks to</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {linked.map((k) => {
              const L = NODES[k];
              return (
                <button key={k} type="button" className="chip gap-1.5" onClick={() => onSelect(k)}>
                  <L.icon className="h-3.5 w-3.5" /> {L.title}
                </button>
              );
            })}
          </div>
        </>
      )}
      <p className={`${kicker} mt-5`}>In the code</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {n.paths.map((p) => (
          <li key={p}>
            <a href={repoLink(p)} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent">
              {p} <ArrowUpRight className="h-3 w-3" />
            </a>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onClear}
        className="mt-5 inline-flex items-center gap-1.5 rounded-sm text-[13px] text-subtle transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring">
        <X className="h-3.5 w-3.5" /> Clear selection
      </button>
    </>
  );
}

function FlowPanel({ flow, step, playing, onStep, onTogglePlay }) {
  const last = flow.steps.length - 1;
  return (
    <>
      <p className={kicker}>Tracing a request</p>
      <PanelTitle icon={flow.icon}>{flow.name}</PanelTitle>
      <ol className="mt-4 space-y-1">
        {flow.steps.map((s, k) => {
          const cur = k === step;
          return (
            <li key={s.text}>
              <button type="button" onClick={() => onStep(k)} aria-current={cur ? 'step' : undefined}
                className={`grid w-full grid-cols-[22px_1fr] gap-2.5 rounded-md border px-2.5 py-2 text-left text-sm leading-relaxed transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring ${
                  cur ? 'border-accent bg-accent-soft text-fg' : 'border-transparent text-muted hover:bg-surface-2'}`}>
                <span className={`mt-0.5 grid h-[22px] w-[22px] place-items-center rounded-full border font-mono text-[11px] ${
                  cur ? 'border-accent bg-accent text-accent-fg' : k < step ? 'border-accent text-accent' : 'border-line-strong text-subtle'}`}>
                  {k + 1}
                </span>
                <span>{s.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex items-center gap-1.5">
        <button type="button" className="btn-secondary h-9 w-9 px-0" aria-label="Previous step"
          disabled={step === 0} onClick={() => onStep(step - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" className="btn-primary h-9 min-w-[96px]" onClick={onTogglePlay}>
          {playing
            ? <><Pause className="h-3.5 w-3.5" /> Pause</>
            : step === last ? <><RotateCcw className="h-3.5 w-3.5" /> Replay</> : <><Play className="h-3.5 w-3.5" /> Play</>}
        </button>
        <button type="button" className="btn-secondary h-9 w-9 px-0" aria-label="Next step"
          disabled={step === last} onClick={() => onStep(step + 1)}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="ml-auto font-mono text-xs tabular-nums text-subtle">{step + 1} / {flow.steps.length}</span>
      </div>
    </>
  );
}
