// Calendar-date helpers. Business dates (start/expiry/billing/due) are DATE columns with no time or
// zone: Prisma returns them as JS Dates at 00:00 UTC. ALL date maths here is UTC to avoid off-by-one
// days on servers in other zones.

import { z } from "zod";
import type { BillingPeriod } from "../generated/prisma/client.js";

const DAY_MS = 86_400_000;

/** "2026-03-31" → Date(2026-03-31T00:00Z). Throws on impossible dates like 2026-02-30. */
export function parseDateOnly(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid date: ${s}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) throw new Error(`Invalid date: ${s}`);
  return dt;
}

export const toDateOnly = (d: Date): string => d.toISOString().slice(0, 10);

/** Today's date (UTC) at 00:00Z. Pass `now` in tests. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);
export const diffDays = (a: Date, b: Date): number => Math.round((a.getTime() - b.getTime()) / DAY_MS);

/** Zod schema for a `YYYY-MM-DD` request field → Date (UTC midnight). */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .transform((s, ctx) => {
    try {
      return parseDateOnly(s);
    } catch {
      ctx.addIssue({ code: "custom", message: "Not a valid calendar date" });
      return z.NEVER;
    }
  });

// ───────── billing schedule ─────────

/** Add whole months, clamping the day to the target month's length (Jan 31 + 1 month = Feb 28/29). */
function addMonthsClamped(anchor: Date, months: number): Date {
  const total = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + months;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchor.getUTCDate(), lastDay)));
}

/**
 * The n-th billing date counted from the subscription's start (n = 0 is the start itself).
 * Always computed from the ANCHOR, never from the previous date, so month-end subscriptions
 * don't drift (Jan 31 → Feb 28 → Mar 31, not Mar 28).
 */
export function nthBillingDate(anchor: Date, period: BillingPeriod, interval: number, n: number): Date {
  const k = n * interval;
  switch (period) {
    case "DAILY":
      return addDays(anchor, k);
    case "WEEKLY":
      return addDays(anchor, 7 * k);
    case "MONTHLY":
      return addMonthsClamped(anchor, k);
    case "YEARLY":
      return addMonthsClamped(anchor, 12 * k);
  }
}

/** First billing date strictly after `current`, on the anchor's schedule. */
export function nextBillingDate(anchor: Date, period: BillingPeriod, interval: number, current: Date): Date {
  if (interval < 1) throw new Error("billing interval must be >= 1");
  // Estimate the index, then correct (clamping can make the estimate off by one).
  let n: number;
  switch (period) {
    case "DAILY":
      n = Math.floor(diffDays(current, anchor) / interval);
      break;
    case "WEEKLY":
      n = Math.floor(diffDays(current, anchor) / (7 * interval));
      break;
    case "MONTHLY":
      n = Math.floor((monthIndex(current) - monthIndex(anchor)) / interval);
      break;
    case "YEARLY":
      n = Math.floor((monthIndex(current) - monthIndex(anchor)) / (12 * interval));
      break;
  }
  n = Math.max(n, 0);
  while (nthBillingDate(anchor, period, interval, n).getTime() <= current.getTime()) n++;
  while (n > 0 && nthBillingDate(anchor, period, interval, n - 1).getTime() > current.getTime()) n--;
  return nthBillingDate(anchor, period, interval, n);
}

const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();

/** The billing period that starts on `periodStart` runs through the day before the next billing date. */
export function billingPeriodEnd(anchor: Date, period: BillingPeriod, interval: number, periodStart: Date): Date {
  return addDays(nextBillingDate(anchor, period, interval, periodStart), -1);
}

/** First scheduled billing date on or after `date` (the anchor itself counts). */
export function billingDateOnOrAfter(anchor: Date, period: BillingPeriod, interval: number, date: Date): Date {
  if (date.getTime() <= anchor.getTime()) return anchor;
  return nextBillingDate(anchor, period, interval, addDays(date, -1));
}
