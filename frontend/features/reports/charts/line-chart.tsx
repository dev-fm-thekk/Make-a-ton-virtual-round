"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { labelIndexes, niceTicks } from "./scale";

export interface Series {
  name: string;
  /** CSS colour, normally a theme token like "var(--series-1)". */
  color: string;
  values: number[];
}

interface Props {
  /** One label per x position (already human-readable). */
  labels: string[];
  series: Series[];
  formatValue: (v: number) => string;
  formatTick?: (v: number) => string;
  ariaLabel: string;
  height?: number;
  /** Dim the chart while a refetch is in flight (keeps the frame, no layout jump). */
  stale?: boolean;
}

// NOTE: SVG presentation attributes (stroke="…", fill="…") do NOT understand var(--token). Colours that come from
// CSS variables must go through `style`, or they silently render as nothing.
const M = { top: 12, right: 12, bottom: 28, left: 56 };

/**
 * Multi-series line chart: crosshair that snaps to the nearest x, one tooltip listing every series,
 * keyboard (arrow keys) and a table view. Colours come from CSS tokens so light/dark both work.
 */
export function LineChart({ labels, series, formatValue, formatTick = formatValue, ariaLabel, height = 280, stale }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = labels.length;
  const innerW = width - M.left - M.right;
  const innerH = height - M.top - M.bottom;
  const max = useMemo(() => Math.max(0, ...series.flatMap((s) => s.values)), [series]);
  const ticks = useMemo(() => niceTicks(max), [max]);
  const top = ticks.at(-1) ?? 1;
  const empty = max === 0;

  const x = (i: number) => M.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => M.top + innerH - (v / top) * innerH;
  const maxLabels = Math.max(2, Math.floor(innerW / 90));
  const shown = labelIndexes(n, maxLabels);

  function nearest(clientX: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    if (n <= 1) return 0;
    return Math.min(n - 1, Math.max(0, Math.round(((px - M.left) / innerW) * (n - 1))));
  }

  const tipLeft = active === null ? 0 : x(active);
  const flip = tipLeft > width * 0.6;

  return (
    <figure className={`transition-opacity ${stale ? "opacity-60" : ""}`} aria-labelledby={titleId}>
      <figcaption id={titleId} className="sr-only">
        {ariaLabel}
      </figcaption>

      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Legend">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-2 text-muted">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} aria-hidden />
              {s.name}
            </li>
          ))}
        </ul>
      )}

      <div
        ref={wrapRef}
        className="relative outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        role="img"
        aria-label={`${ariaLabel}. Use left and right arrow keys to read values.`}
        onPointerMove={(e) => setActive(nearest(e.clientX))}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
          else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
          else if (e.key === "Escape") setActive(null);
        }}
      >
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block overflow-visible">
          {/* recessive grid + y labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} strokeWidth={1} style={{ stroke: "var(--chart-grid)" }} />
              <text x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted text-[11px]">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {shown.map((i) => (
            <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-muted text-[11px]">
              {labels[i]}
            </text>
          ))}

          {/* lines (2px, round joins) */}
          {series.map((s) => (
            <polyline key={s.name} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} style={{ stroke: s.color }} />
          ))}
          {/* a lone point has no line to draw, so show a marker */}
          {n === 1 && series.map((s) => <circle key={s.name} cx={x(0)} cy={y(s.values[0] ?? 0)} r={4} style={{ fill: s.color }} />)}

          {/* crosshair + markers with a surface ring */}
          {active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + innerH} strokeWidth={1} strokeDasharray="3 3" style={{ stroke: "var(--muted)" }} />
              {series.map((s) => (
                <circle key={s.name} cx={x(active)} cy={y(s.values[active] ?? 0)} r={4.5} strokeWidth={2} style={{ fill: s.color, stroke: "var(--surface)" }} />
              ))}
            </g>
          )}
        </svg>

        {empty && <p className="pointer-events-none absolute inset-0 grid place-items-center pb-6 text-sm text-muted">No activity in this period</p>}

        {active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 min-w-40 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-lg"
            style={{ top: M.top, left: flip ? undefined : tipLeft + 12, right: flip ? width - tipLeft + 12 : undefined }}
          >
            <p className="mb-1 text-xs text-muted">{labels[active]}</p>
            {series.map((s) => (
              <p key={s.name} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-muted">
                  <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} aria-hidden />
                  {s.name}
                </span>
                <span className="font-semibold tabular-nums">{formatValue(s.values[active] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <button type="button" onClick={() => setShowTable((v) => !v)} className="mt-2 text-xs text-muted underline-offset-2 hover:text-foreground hover:underline" aria-expanded={showTable}>
        {showTable ? "Hide data table" : "View as table"}
      </button>
      {showTable && (
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Period</th>
                {series.map((s) => (
                  <th key={s.name} className="px-3 py-2 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {labels.map((l, i) => (
                <tr key={`${l}-${i}`}>
                  <td className="px-3 py-1.5">{l}</td>
                  {series.map((s) => (
                    <td key={s.name} className="px-3 py-1.5 text-right tabular-nums">
                      {formatValue(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
