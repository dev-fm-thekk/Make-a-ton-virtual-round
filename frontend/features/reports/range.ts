// Date-range presets for the finance screens. Pure and UTC-based so it matches the API's day boundaries.

import { addDaysIso, todayIso } from "@/lib/format";
import type { GroupBy } from "./types";

export type Preset = "month" | "30d" | "90d" | "year" | "custom";

export const PRESETS: { id: Preset; label: string }[] = [
  { id: "month", label: "This month" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "year", label: "This year" },
  { id: "custom", label: "Custom" },
];

export interface Range {
  from: string;
  to: string;
}

/** The API rejects ranges longer than 5 years. */
export const MAX_RANGE_DAYS = 366 * 5;

/** Resolve a preset (or the custom from/to) to concrete inclusive dates. Invalid custom input falls back to this month. */
export function resolveRange(preset: string, custom: { from?: string; to?: string }, today = todayIso()): Range {
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "30d":
      return { from: addDaysIso(today, -29), to: today };
    case "90d":
      return { from: addDaysIso(today, -89), to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom": {
      const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
      if (ok(custom.from) && ok(custom.to) && custom.from! <= custom.to! && daysIn({ from: custom.from!, to: custom.to! }) <= MAX_RANGE_DAYS) {
        return { from: custom.from!, to: custom.to! };
      }
      return { from: monthStart, to: today };
    }
    default:
      return { from: monthStart, to: today };
  }
}

/** Number of days in the inclusive range. */
export function daysIn(r: Range): number {
  return Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) + 1;
}

/** A sensible bucket size so charts have ~10-60 points. */
export function defaultGroupBy(r: Range): GroupBy {
  const d = daysIn(r);
  return d <= 62 ? "day" : d <= 190 ? "week" : "month";
}

/** The API rejects more than 400 buckets; offer only the sizes that fit. */
export function allowedGroupBy(r: Range): GroupBy[] {
  const d = daysIn(r);
  const out: GroupBy[] = [];
  if (d <= 400) out.push("day");
  if (Math.ceil(d / 7) + 1 <= 400) out.push("week");
  out.push("month");
  return out;
}
