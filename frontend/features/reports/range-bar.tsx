"use client";

import clsx from "clsx";
import { Input } from "@/components/ui";
import { useUrlParams } from "@/lib/hooks";
import { PRESETS, resolveRange, type Preset, type Range } from "./range";

type Choice = Preset | "all";

// Module-level constants: useUrlParams relies on stable defaults.
const DEFAULTS_MONTH = { range: "month", from: "", to: "", page: "1" };
const DEFAULTS_ALL = { range: "all", from: "", to: "", page: "1" };

/**
 * The date range shared by the finance screens, kept in the URL (?range=90d, or ?range=custom&from=…&to=…).
 * Lists pass `allowAll` so older unpaid invoices aren't hidden by a "this month" default.
 */
export function useReportRange(allowAll = false) {
  const [q, set] = useUrlParams(allowAll ? DEFAULTS_ALL : DEFAULTS_MONTH);
  const valid = PRESETS.some((p) => p.id === q.range) || (allowAll && q.range === "all");
  const choice = (valid ? q.range : allowAll ? "all" : "month") as Choice;
  const range: Range | null = choice === "all" ? null : resolveRange(choice, { from: q.from, to: q.to });
  return {
    allowAll,
    choice,
    /** null = all time (only when `allowAll`). */
    range,
    setChoice: (c: Choice) => set(c === "custom" && range ? { range: c, from: range.from, to: range.to } : { range: c, from: "", to: "" }),
    setCustom: (patch: { from: string; to: string }) => set({ range: "custom", ...patch }),
  };
}

export type ReportRange = ReturnType<typeof useReportRange>;

/** Overview needs a concrete range. */
export function useRequiredRange() {
  const r = useReportRange(false);
  return { ...r, range: r.range! };
}

/** One row above the content it scopes: presets first, custom dates behind "Custom". */
export function RangeBar({ value }: { value: ReportRange }) {
  const options: { id: Choice; label: string }[] = [...(value.allowAll ? [{ id: "all" as const, label: "All time" }] : []), ...PRESETS];
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range">
        {options.map((p) => (
          <button
            key={p.id}
            aria-pressed={value.choice === p.id}
            onClick={() => value.setChoice(p.id)}
            className={clsx(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              value.choice === p.id ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.choice === "custom" && value.range && (
        <div className="flex items-end gap-2">
          <Input label="From" type="date" max={value.range.to} value={value.range.from} onChange={(e) => e.target.value && value.setCustom({ from: e.target.value, to: value.range!.to })} />
          <Input label="To" type="date" min={value.range.from} value={value.range.to} onChange={(e) => e.target.value && value.setCustom({ from: value.range!.from, to: e.target.value })} />
        </div>
      )}
    </div>
  );
}
