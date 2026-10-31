import { Prisma } from "../generated/prisma/client.js";

export type Decimal = Prisma.Decimal;
/** Anything Decimal can be built from. */
export type Num = Prisma.Decimal | string | number;
export const D = (v: Num): Decimal => new Prisma.Decimal(v);
export const ZERO = D(0);
export const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/** Money rounds half-up to 2 decimals (the usual invoicing convention). */
export const round2 = (v: Num): Decimal => D(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** JSON representation: always a fixed 2-decimal string, e.g. "1250.00". Never a float. */
export const money = (v: Num | null | undefined): string => (v == null ? "0.00" : round2(v).toFixed(2));

export const sum = (values: Num[]): Decimal => values.reduce<Decimal>((a, b) => a.plus(b), ZERO);

/** A line's money maths: amount = qty × unit; tax = amount × rate% (each rounded to cents). */
export function lineAmounts(quantity: number, unitPrice: Num, taxRatePercent: Num) {
  const amount = round2(D(unitPrice).times(quantity));
  const tax = round2(amount.times(taxRatePercent).dividedBy(100));
  return { amount, tax, total: amount.plus(tax) };
}
