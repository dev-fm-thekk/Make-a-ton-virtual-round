// Invoice maths as a PURE function: lines + discount rules in, exact money out. No database, no clock,
// so every rounding and stacking rule below is unit-tested.
//
// Rules (also documented for the finance team):
//  1. Line amount = quantity × unit price, rounded half-up to the cent.
//  2. Discounts apply BEFORE tax: tax = (amount − discount) × rate%, rounded per line.
//  3. Order: product-scoped discounts first, then subscription-scoped ones; ties broken by id (deterministic).
//     Each discount works on what is LEFT after earlier ones, so stacked discounts can never exceed the subtotal.
//  4. A product discount targets the lines of its products; a subscription discount targets every line.
//     Minimum quantity / minimum purchase are checked against the targeted lines' ORIGINAL amounts.
//  5. FIXED takes a flat amount (capped at what is left); PERCENTAGE takes that % of what is left.
//  6. A discount's total is split across its target lines in proportion to their remaining amounts, to the exact cent
//     (largest-remainder), so line discounts always add up to the discount.

import { D, ROUND_HALF_UP, round2, ZERO, type Decimal, type Num } from "../../lib/money.js";

export interface CalcLineInput {
  /** Caller's id for the line, echoed back (e.g. the subscription line id). */
  key: string;
  quantity: number;
  unitPrice: Num;
  productId: string | null;
  taxRatePercent: Num;
}

export interface DiscountRule {
  id: string;
  type: "FIXED" | "PERCENTAGE";
  value: Num;
  scope: "PRODUCT" | "SUBSCRIPTION";
  minPurchaseAmount: Num | null;
  minQuantity: number | null;
  /** Products a PRODUCT-scoped discount applies to (ignored for SUBSCRIPTION scope). */
  productIds: ReadonlySet<string>;
}

export interface CalcLine {
  key: string;
  quantity: number;
  unitPrice: Decimal;
  amount: Decimal;
  discountAmount: Decimal;
  taxRatePercent: Decimal;
  taxAmount: Decimal;
  /** amount − discount + tax */
  lineTotal: Decimal;
}

export interface CalcResult {
  lines: CalcLine[];
  subtotal: Decimal;
  discountTotal: Decimal;
  taxTotal: Decimal;
  total: Decimal;
  /** One entry per discount that actually reduced the invoice. */
  applied: { discountId: string; amount: Decimal }[];
}

const toCents = (d: Decimal): number => d.times(100).toNumber(); // d is already rounded to 2dp → integral
const fromCents = (c: number): Decimal => D(c).dividedBy(100);

/**
 * Split `totalCents` across `weights` proportionally, exactly (largest remainder; ties → earlier line).
 * Precondition: totalCents ≤ Σ weights (callers cap the discount at what is left), which keeps every share ≤ its weight.
 */
export function allocate(totalCents: number, weights: number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (totalCents <= 0 || sumW <= 0) return weights.map(() => 0);
  const t = BigInt(totalCents);
  const sw = BigInt(sumW);
  const base = weights.map((w) => (t * BigInt(w)) / sw);
  const rem = weights.map((w) => (t * BigInt(w)) % sw);
  let left = Number(t - base.reduce((a, b) => a + b, 0n));
  const order = rem.map((r, i) => ({ r, i })).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = base.map(Number);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]! += 1;
    left -= 1;
  }
  return out;
}

export function computeInvoice(inputs: CalcLineInput[], rules: DiscountRule[]): CalcResult {
  const amounts = inputs.map((l) => round2(D(l.unitPrice).times(l.quantity)));
  const orig = amounts.map(toCents);
  const remaining = [...orig];
  const discounted = inputs.map(() => 0);
  const applied: CalcResult["applied"] = [];

  const ordered = [...rules].sort((a, b) => (a.scope === b.scope ? a.id.localeCompare(b.id) : a.scope === "PRODUCT" ? -1 : 1));

  for (const rule of ordered) {
    const target = inputs.flatMap((l, i) => (rule.scope === "SUBSCRIPTION" || (l.productId !== null && rule.productIds.has(l.productId)) ? [i] : []));
    if (target.length === 0) continue;

    const qty = target.reduce((n, i) => n + inputs[i]!.quantity, 0);
    const originalBase = target.reduce((n, i) => n + orig[i]!, 0);
    if (rule.minQuantity !== null && qty < rule.minQuantity) continue;
    if (rule.minPurchaseAmount !== null && originalBase < toCents(round2(rule.minPurchaseAmount))) continue;

    const left = target.reduce((n, i) => n + remaining[i]!, 0);
    if (left <= 0) continue;

    const wanted =
      rule.type === "FIXED"
        ? toCents(round2(rule.value))
        : D(left).times(rule.value).dividedBy(100).toDecimalPlaces(0, ROUND_HALF_UP).toNumber();
    const amount = Math.min(wanted, left);
    if (amount <= 0) continue;

    const shares = allocate(amount, target.map((i) => remaining[i]!));
    target.forEach((lineIdx, k) => {
      remaining[lineIdx]! -= shares[k]!;
      discounted[lineIdx]! += shares[k]!;
    });
    applied.push({ discountId: rule.id, amount: fromCents(amount) });
  }

  const lines: CalcLine[] = inputs.map((l, i) => {
    const amount = amounts[i]!;
    const discountAmount = fromCents(discounted[i]!);
    const rate = D(l.taxRatePercent);
    const taxAmount = round2(amount.minus(discountAmount).times(rate).dividedBy(100));
    return { key: l.key, quantity: l.quantity, unitPrice: round2(l.unitPrice), amount, discountAmount, taxRatePercent: rate, taxAmount, lineTotal: amount.minus(discountAmount).plus(taxAmount) };
  });

  const sum = (f: (l: CalcLine) => Decimal) => lines.reduce((t, l) => t.plus(f(l)), ZERO);
  const subtotal = sum((l) => l.amount);
  const discountTotal = sum((l) => l.discountAmount);
  const taxTotal = sum((l) => l.taxAmount);
  return { lines, subtotal, discountTotal, taxTotal, total: subtotal.minus(discountTotal).plus(taxTotal), applied };
}

/** Is this rule usable for an invoice issued on `onDate`? (window, active flag, usage left: a snapshot, the guarded update is authoritative) */
export function isRuleLive(
  d: { isActive: boolean; deletedAt: Date | null; startDate: Date; endDate: Date | null; usageLimit: number | null; usedCount: number },
  onDate: Date,
): boolean {
  return d.isActive && d.deletedAt === null && d.startDate <= onDate && (d.endDate === null || d.endDate >= onDate) && (d.usageLimit === null || d.usedCount < d.usageLimit);
}
