// Display formatting. The API sends money as fixed 2-decimal strings ("1250.00") and calendar dates as
// "YYYY-MM-DD"; this is the only place they become human text. Never do arithmetic on display values.

/** Single-currency system today (invoices default to INR). Change here if multi-currency arrives. */
export const CURRENCY = "INR";

const moneyFmt = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY });
const compactFmt = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY, notation: "compact", maximumFractionDigits: 1 });

export function formatMoney(value: string | number | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return moneyFmt.format(Number.isFinite(n) ? n : 0);
}

/** Axis ticks / big numbers: 1.2M, 340K. */
export function formatMoneyCompact(value: string | number): string {
  return compactFmt.format(Number(value));
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n);
}

/** "2026-03-31" → "31 Mar 2026". Parsed as a calendar date, never through a local-time Date (no off-by-one day). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** A real timestamp (ISO with zone) in the viewer's locale and zone. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "2026-03-31" → "Mar 2026" (chart month buckets). */
export function formatMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

/** Today as YYYY-MM-DD in UTC — matches the API's day boundaries. */
export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

export const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;
