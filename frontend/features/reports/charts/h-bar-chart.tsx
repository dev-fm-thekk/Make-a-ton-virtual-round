"use client";

export interface BarDatum {
  label: string;
  value: number;
  /** Text shown at the end of the bar (a formatted value). */
  display: string;
  /** Small secondary text under the label (e.g. "3 invoices"). */
  sub?: string;
}

/**
 * Single-series horizontal bars, one row per category, with the value written at the end of each bar
 * (direct labels, so nothing depends on hover or colour). Bars are thin with a rounded data end.
 */
export function HBarChart({ data, ariaLabel, stale }: { data: BarDatum[]; ariaLabel: string; stale?: boolean }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  return (
    <ul aria-label={ariaLabel} className={`space-y-3 transition-opacity ${stale ? "opacity-60" : ""}`}>
      {data.map((d) => {
        const pct = max > 0 ? (d.value / max) * 100 : 0;
        return (
          <li key={d.label} title={`${d.label}: ${d.display}`} className="grid grid-cols-[minmax(5rem,9rem)_1fr_auto] items-center gap-3 text-sm">
            <div className="min-w-0">
              <p className="truncate">{d.label}</p>
              {d.sub && <p className="truncate text-xs text-muted">{d.sub}</p>}
            </div>
            <div className="h-2.5 rounded-full bg-surface-2" role="presentation">
              {/* a zero value draws no bar at all; tiny values keep a visible sliver */}
              {d.value > 0 && <div className="h-full rounded-r-md rounded-l-sm" style={{ width: `${Math.max(pct, 1.5)}%`, background: "var(--series-1)" }} />}
            </div>
            <span className="min-w-20 text-right font-medium tabular-nums">{d.display}</span>
          </li>
        );
      })}
    </ul>
  );
}
