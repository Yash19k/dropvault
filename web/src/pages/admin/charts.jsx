// Column chart for the admin panel: one series in the accent color, thin
// columns with a rounded data end on one baseline, a recessive axis, a
// tooltip on hover and on keyboard focus (arrow keys), and a table view of the
// same numbers.
import { useId, useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { formatCount } from '../../lib/format';

const PLOT_HEIGHT = 128;

// A clean axis maximum: 1, 2, 5, 10, 20, 50, ...
function niceMax(value) {
  if (value <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].map((m) => m * step).find((m) => m >= value);
}

// points: [{ key, short, label, value }]  short = axis label, label = tooltip / table label
export function ColumnChart({ points, format = formatCount, title, emptyText = 'Nothing in this period' }) {
  const [active, setActive] = useState(null);
  const liveId = useId();
  const peak = Math.max(0, ...points.map((p) => p.value));
  const max = niceMax(peak);
  const total = points.reduce((n, p) => n + p.value, 0);
  const shown = active !== null ? points[active] : null;

  const onKey = (e) => {
    if (!points.length) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); setActive((i) => (i === null ? 0 : Math.min(points.length - 1, i + 1))); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((i) => (i === null ? points.length - 1 : Math.max(0, i - 1))); }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    if (e.key === 'End') { e.preventDefault(); setActive(points.length - 1); }
  };

  return (
    <div>
      <div className="flex">
        <div className="relative w-10 shrink-0 text-[11px] text-subtle tabular-nums" style={{ height: PLOT_HEIGHT }} aria-hidden="true">
          <span className="absolute right-2 top-0 -translate-y-1/2">{format(max)}</span>
          <span className="absolute bottom-0 right-2 translate-y-1/2">0</span>
        </div>
        <div
          className="relative flex-1 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring"
          style={{ height: PLOT_HEIGHT }}
          tabIndex={0}
          role="group"
          aria-label={`${title}: ${format(total)} in total. Use the arrow keys to read each column.`}
          aria-describedby={liveId}
          onKeyDown={onKey}
          onFocus={() => setActive((i) => (i === null ? points.length - 1 : i))}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          <div className="absolute inset-x-0 top-0 border-t border-line" />
          <div className="absolute inset-x-0 bottom-0 border-t border-line-strong" />
          {peak === 0 && (
            <div className="absolute inset-0 grid place-items-center text-xs text-subtle">{emptyText}</div>
          )}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {points.map((p, i) => (
              <div key={p.key} className="flex h-full min-w-0 flex-1 items-end justify-center" onPointerEnter={() => setActive(i)}>
                <div
                  className={`w-full max-w-6 rounded-t-[4px] transition-colors ${active === i ? 'bg-accent-hover' : 'bg-accent'}`}
                  style={{ height: p.value ? `max(2px, ${(p.value / max) * 100}%)` : 0 }}
                />
              </div>
            ))}
          </div>
          {shown && (
            <div
              className="panel pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap px-2.5 py-1.5 shadow-sm"
              style={{
                left: `${Math.min(88, Math.max(12, ((active + 0.5) / points.length) * 100))}%`,
                bottom: `calc(${Math.min(100, (shown.value / max) * 100)}% + 8px)`,
              }}
            >
              <div className="text-sm font-semibold tabular-nums">{format(shown.value)}</div>
              <div className="text-[11px] text-muted">{shown.label}</div>
            </div>
          )}
          <span id={liveId} className="sr-only" aria-live="polite">
            {shown ? `${shown.label}: ${format(shown.value)}` : ''}
          </span>
        </div>
      </div>
      {points.length > 0 && (
        <div className="ml-10 mt-1.5 flex justify-between text-[11px] text-subtle" aria-hidden="true">
          <span>{points[0].short}</span>
          <span>{points[points.length - 1].short}</span>
        </div>
      )}
    </div>
  );
}

// A chart in a card, with its total and a switch to a table of the same numbers.
export function ChartCard({ title, total, note, points, format = formatCount, emptyText }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="panel px-4 pb-3 pt-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="mt-0.5 text-2xl font-semibold tracking-tight">{total}</div>
        </div>
        <button className="btn-icon" onClick={() => setAsTable((v) => !v)}
          title={asTable ? 'Show as chart' : 'Show as table'} aria-label={asTable ? `Show ${title} as a chart` : `Show ${title} as a table`}>
          {asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
        </button>
      </div>
      <div className="mt-3">
        {asTable ? (
          <div className="overflow-y-auto rounded-md border border-line" style={{ height: PLOT_HEIGHT + 22 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-2 text-muted">
                <tr><th className="px-3 py-1.5 text-left font-medium">Period</th><th className="px-3 py-1.5 text-right font-medium">{title}</th></tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {[...points].reverse().map((p) => (
                  <tr key={p.key}><td className="px-3 py-1.5 text-muted">{p.label}</td><td className="px-3 py-1.5 text-right">{format(p.value)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ColumnChart points={points} format={format} title={title} emptyText={emptyText} />
        )}
      </div>
      {note && <p className="mt-2 text-[11px] text-subtle">{note}</p>}
    </section>
  );
}
