// Client-side money PREVIEW maths (live totals in the line editor) in integer cents.
// The server is authoritative and recomputes everything; this mirrors its rules exactly
// (amount = qty × unit, tax = amount × rate%, each rounded half-up to the cent) so the preview matches the saved result.

/** "1560.00" | "1560" | 1560 → 156000. Returns NaN for unparseable input. */
export function toCents(value: string | number): number {
  const s = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export const fromCents = (cents: number): string => (cents / 100).toFixed(2);

/** Half-up integer division (non-negative values). */
const divRound = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));

export interface LineMath {
  amount: number;
  tax: number;
  total: number;
}

/** `ratePercent` is the tax percentage as a string/number with up to 2 decimals (e.g. "18.00"). */
export function lineMath(quantity: number, unitCents: number, ratePercent: string | number): LineMath {
  const amount = quantity * unitCents;
  const rateBp = Math.round(Number(ratePercent) * 100); // basis points: 18.00% → 1800
  const tax = divRound(amount * rateBp, 10_000);
  return { amount, tax, total: amount + tax };
}

export function sumLines(lines: LineMath[]): LineMath {
  return lines.reduce((t, l) => ({ amount: t.amount + l.amount, tax: t.tax + l.tax, total: t.total + l.total }), { amount: 0, tax: 0, total: 0 });
}
