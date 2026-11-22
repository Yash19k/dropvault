// Charts for the admin Analytics page. Same rules as charts.jsx: one accent
// series per chart (the title names it), 2px lines with a 10% area wash,
// hairline solid grid, text in text colours (never the series colour), a
// tooltip on hover and on keyboard focus, and the numbers available as a table.
// Series colours are the --viz-* tokens in index.css, checked for colour-blind
// separation in light and dark.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { formatCount } from '../../lib/format';

// A clean axis maximum: 1, 2, 5, 10, 20, 50, ...
export function niceMax(value) {
  if (value <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((m) => m * step).find((m) => m >= value);
}

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// Arrow keys / Home / End move a highlighted index; shared by the charts.
function useKeyboardIndex(count, setActive) {
  return (e) => {
    if (!count) return;
    const keys = {
      ArrowRight: (i) => (i === null ? 0 : Math.min(count - 1, i + 1)),
      ArrowLeft: (i) => (i === null ? count - 1 : Math.max(0, i - 1)),
      Home: () => 0,
      End: () => count - 1,
    };
    if (keys[e.key]) { e.preventDefault(); setActive(keys[e.key]); }
  };
}

function Tooltip({ x, y, width, children }) {
  // keep the box inside the plot: flip to the left of the cursor near the right edge
  const flip = x > width - 150;
  return (
    <div className="panel pointer-events-none absolute z-10 whitespace-nowrap px-2.5 py-1.5 shadow-sm"
      style={{ left: x, top: Math.max(0, y - 8), transform: `translate(${flip ? 'calc(-100% - 10px)' : '10px'}, -100%)` }}>
      {children}
    </div>
  );
}

// --- line / area over time ---------------------------------------------------------
// points: [{ key, label, short, value }]  label = tooltip/table text, short = axis text
export function TrendChart({ points, title, format = formatCount, axisFormat, height = 200,
  color = 'var(--viz-1)', emptyText = 'Nothing in this period' }) {
  const axis = axisFormat || format;
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const liveId = useId();
  const gradientId = useId();
  const left = 44;
  const right = 12;
  const top = 10;
  const bottom = 24;
  const plotW = Math.max(0, width - left - right);
  const plotH = height - top - bottom;
  const peak = Math.max(0, ...points.map((p) => p.value));
  const max = niceMax(peak);
  const n = points.length;
  const x = (i) => left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => top + plotH - (v / max) * plotH;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = n ? `${line}L${x(n - 1).toFixed(1)},${top + plotH}L${x(0).toFixed(1)},${top + plotH}Z` : '';
  const ticks = [0, max / 2, max];
  const shown = active !== null ? points[active] : null;
  const total = points.reduce((s, p) => s + p.value, 0);
  const onKey = useKeyboardIndex(n, setActive);

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left - left;
    if (n === 0 || plotW <= 0) return;
    setActive(Math.max(0, Math.min(n - 1, Math.round((px / plotW) * (n - 1)))));
  };
  const labelIdx = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : points.map((_, i) => i);

  return (
    <div ref={ref} className="relative rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring"
      style={{ height }} tabIndex={0} role="group"
      aria-label={`${title}. Use the arrow keys to read each point.`} aria-describedby={liveId}
      onKeyDown={onKey} onFocus={() => setActive((i) => (i === null ? n - 1 : i))} onBlur={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible" onPointerMove={onMove}
          onPointerLeave={() => setActive(null)} aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.14" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <g key={t}>
              <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)}
                stroke={i === 0 ? 'var(--line-strong)' : 'var(--line)'} strokeWidth="1" shapeRendering="crispEdges" />
              <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-subtle text-[11px] tabular-nums">
                {axis(t)}
              </text>
            </g>
          ))}
          {labelIdx.map((i) => (
            <text key={points[i].key} x={x(i)} y={height - 6}
              textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}
              className="fill-subtle text-[11px]">{points[i].short}</text>
          ))}
          {peak > 0 && (
            <>
              <path d={area} fill={`url(#${gradientId})`} />
              <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {active === null && (
                <circle cx={x(n - 1)} cy={y(points[n - 1].value)} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
              )}
            </>
          )}
          {shown && (
            <>
              <line x1={x(active)} x2={x(active)} y1={top} y2={top + plotH} stroke="var(--line-strong)" strokeWidth="1" />
              <circle cx={x(active)} cy={y(shown.value)} r="4.5" fill={color} stroke="var(--surface)" strokeWidth="2" />
            </>
          )}
        </svg>
      )}
      {peak === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-subtle">{emptyText}</div>
      )}
      {shown && width > 0 && (
        <Tooltip x={x(active)} y={y(shown.value)} width={width}>
          <div className="text-sm font-semibold tabular-nums">{format(shown.value)}</div>
          <div className="text-[11px] text-muted">{shown.label}</div>
        </Tooltip>
      )}
      <span id={liveId} className="sr-only" aria-live="polite">
        {shown ? `${shown.label}: ${format(shown.value)}` : `${format(total)} in total`}
      </span>
    </div>
  );
}

// --- sparkline (stat tiles) -----------------------------------------------------------
export function Sparkline({ values, height = 28, className = '' }) {
  const [ref, width] = useWidth();
  const n = values.length;
  const max = Math.max(1, ...values);
  const x = (i) => 2 + (n <= 1 ? 0 : (i / (n - 1)) * (width - 6));
  const y = (v) => 3 + (height - 6) * (1 - v / max);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <div ref={ref} className={className} style={{ height }} aria-hidden="true">
      {width > 0 && n > 1 && (
        <svg width={width} height={height} className="block overflow-visible">
          <path d={d} fill="none" stroke="var(--fg-subtle)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(n - 1)} cy={y(values[n - 1])} r="3" fill="var(--viz-1)" stroke="var(--surface)" strokeWidth="1.5" />
        </svg>
      )}
    </div>
  );
}

// --- weekday x hour heatmap -------------------------------------------------------------
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STEPS = [18, 36, 56, 78, 100]; // % of the series colour mixed into the surface

const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

export function Heatmap({ grid, format, title }) {
  const [active, setActive] = useState(null); // [day, hour]
  const liveId = useId();
  const max = Math.max(0, ...grid.flat());
  const step = (v) => (v <= 0 || max === 0 ? -1 : Math.min(STEPS.length - 1, Math.floor((v / max) * STEPS.length - 1e-9)));
  const fill = (v) => {
    const s = step(v);
    return s < 0 ? 'var(--surface-2)' : `color-mix(in oklab, var(--viz-1) ${STEPS[s]}%, var(--surface))`;
  };
  const onKey = (e) => {
    const move = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
    if (!move) return;
    e.preventDefault();
    setActive(([d, h] = [0, 0]) => [Math.max(0, Math.min(6, d + move[0])), Math.max(0, Math.min(23, h + move[1]))]);
  };
  const shown = active ? { day: DAYS[active[0]], hour: active[1], value: grid[active[0]][active[1]] } : null;
  return (
    <div>
      <div className="relative rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring" tabIndex={0}
        role="group" aria-label={`${title}. Use the arrow keys to read each hour.`} aria-describedby={liveId}
        onKeyDown={onKey} onFocus={() => setActive((a) => a || [0, 0])} onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}>
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: '32px repeat(24, minmax(0, 1fr))' }}>
          {grid.map((row, d) => (
            <div key={DAYS[d]} className="contents">
              <div className="pr-1.5 text-right text-[11px] leading-[18px] text-subtle">{DAYS[d]}</div>
              {row.map((v, h) => (
                <div key={h} onPointerEnter={() => setActive([d, h])}
                  className={`h-[18px] rounded-[3px] ${active && active[0] === d && active[1] === h ? 'ring-2 ring-fg/60' : ''}`}
                  style={{ background: fill(v) }} />
              ))}
            </div>
          ))}
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="whitespace-nowrap pt-1 text-[10px] text-subtle">{h % 6 === 0 ? hourLabel(h) : ''}</div>
          ))}
        </div>
        <span id={liveId} className="sr-only" aria-live="polite">
          {shown ? `${shown.day} ${hourLabel(shown.hour)}: ${format(shown.value)}` : ''}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span className="tabular-nums">
          {shown ? <><span className="font-medium text-fg">{shown.day}, {hourLabel(shown.hour)}</span> · {format(shown.value)}</> : 'Point at a square for its number'}
        </span>
        <span className="flex items-center gap-1.5" aria-hidden="true">
          Less
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'var(--surface-2)' }} />
          {STEPS.map((s) => (
            <span key={s} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: `color-mix(in oklab, var(--viz-1) ${s}%, var(--surface))` }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

// --- one whole in parts (thin segmented bar + legend) ---------------------------------
// parts: [{ name, value, color }] in a fixed order (colour follows the part, not its rank)
export function SegmentBar({ parts, format = formatCount, label }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const visible = parts.filter((p) => p.value > 0);
  const share = (v) => (total ? Math.round((v / total) * 100) : 0);
  return (
    <div>
      <div className="flex h-2 gap-[2px]" role="img"
        aria-label={`${label}: ${parts.map((p) => `${p.name} ${format(p.value)} (${share(p.value)}%)`).join(', ')}`}>
        {total === 0 ? <div className="h-full w-full rounded-full bg-surface-2" /> : visible.map((p) => (
          <div key={p.name} className="h-full rounded-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(p.value / total) * 100}%`, background: p.color, minWidth: 4 }}
            title={`${p.name}: ${format(p.value)} (${share(p.value)}%)`} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {parts.map((p) => (
          <li key={p.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden="true" />
              <span className="truncate">{p.name}</span>
            </span>
            <span className="shrink-0 text-xs text-muted tabular-nums">{format(p.value)} · {share(p.value)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- funnel ----------------------------------------------------------------------------
export function Funnel({ steps }) {
  const first = steps[0]?.count || 0;
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1].count : null;
        const raw = prev ? (s.count / prev) * 100 : null;
        const conv = raw === null ? null : raw > 0 && raw < 1 ? raw.toFixed(1) : Math.round(raw);
        return (
          <li key={s.step}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="mr-2 text-xs text-subtle tabular-nums">{i + 1}</span>{s.step}
              </span>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                <span className="font-medium text-fg">{formatCount(s.count)}</span>
                {i > 0 && <> · {conv === null ? '—' : `${conv}% of step ${i}`}</>}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-viz-1"
                style={{ width: `${first ? Math.max(s.count ? 1 : 0, (s.count / first) * 100) : 0}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// --- retention cohorts ---------------------------------------------------------------------
// rows: [{ week: 'yyyy-mm-dd', size, weeks: [pct|null, ...] }]
export function RetentionTable({ rows }) {
  const cols = Math.max(0, ...rows.map((r) => r.weeks.length));
  const cell = (pct) => {
    if (pct === null || pct === undefined) return { background: 'transparent' };
    if (pct === 0) return { background: 'var(--surface-2)' };
    const mix = 14 + Math.round((Math.min(100, pct) / 100) * 86);
    // the label switches to --viz-ink where it reads better than the body text
    const switchAt = document.documentElement.dataset.theme === 'dark' ? 70 : 90;
    return { background: `color-mix(in oklab, var(--viz-1) ${mix}%, var(--surface))`,
      color: mix > switchAt ? 'var(--viz-ink)' : 'var(--fg)' };
  };
  const weekLabel = (w) => new Date(`${w}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-separate text-xs" style={{ borderSpacing: 2 }}>
        <thead className="text-muted">
          <tr>
            <th className="px-2 py-1 text-left font-medium">Signed up week of</th>
            <th className="px-2 py-1 text-right font-medium">Accounts</th>
            {Array.from({ length: cols }, (_, i) => <th key={i} className="px-1 py-1 text-center font-medium">Wk {i + 1}</th>)}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {[...rows].reverse().map((r) => (
            <tr key={r.week}>
              <td className="whitespace-nowrap px-2 py-1.5 text-muted">{weekLabel(r.week)}</td>
              <td className="px-2 py-1.5 text-right">{r.size}</td>
              {Array.from({ length: cols }, (_, i) => {
                const pct = r.size ? r.weeks[i] : null;
                return (
                  <td key={i} className="h-7 min-w-10 rounded-[3px] px-1 text-center" style={cell(pct)}
                    title={pct === null || pct === undefined ? undefined : `${pct}% came back in week ${i + 1}`}>
                    {pct === null || pct === undefined ? '' : `${Math.round(pct)}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Re-render on an interval (relative times like "3 min" stay current).
export function useTick(ms) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
