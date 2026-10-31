// ──────────────────────────────────────────────────────────────────────────────
// Billing contract (consumed by Package 6 – the billing engine). Everything here must run
// INSIDE the engine's per-subscription transaction so the claim, the invoice and the schedule
// advance commit (or roll back) together.
//
//   1. claimDueSubscriptions(tx, asOf, n)  – lock up to n due ACTIVE subscriptions (SKIP LOCKED: safe on N workers)
//   2. …build + insert the invoice for sub.nextBillingDate (unique (subscriptionId, periodStart) prevents doubles)
//   3. advanceBilling(tx, sub)             – move nextBillingDate to the next scheduled date (or null at expiry)
// ──────────────────────────────────────────────────────────────────────────────

import { billingPeriodEnd, nextBillingDate, toDateOnly } from "../../lib/dates.js";
import type { Tx } from "../../lib/shared.js";

const claimInclude = {
  customer: true,
  plan: true,
  paymentTerm: true,
  lines: { orderBy: { sortOrder: "asc" as const }, include: { product: { select: { name: true } }, variant: true, tax: true } },
  discounts: { include: { discount: { include: { products: true } } } },
};

/**
 * Locks and returns subscriptions due for invoicing on `asOf`, oldest due date first.
 * Rows stay locked until the surrounding transaction ends; concurrent workers skip them.
 */
export async function claimDueSubscriptions(tx: Tx, asOf: Date, limit: number) {
  const ids = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "subscriptions"
    WHERE "status" = 'ACTIVE' AND "nextBillingDate" <= ${toDateOnly(asOf)}::date
    ORDER BY "nextBillingDate", "id"
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED`;
  if (ids.length === 0) return [];
  const subs = await tx.subscription.findMany({ where: { id: { in: ids.map((r) => r.id) } }, include: claimInclude });
  // findMany doesn't preserve the claim order.
  const order = new Map(ids.map((r, i) => [r.id, i]));
  return subs.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

export type DueSubscription = Awaited<ReturnType<typeof claimDueSubscriptions>>[number];

/** The invoice period being billed for a claimed subscription: [periodStart, periodEnd]. */
export function currentPeriod(sub: Pick<DueSubscription, "startDate" | "nextBillingDate" | "plan">) {
  const periodStart = sub.nextBillingDate!;
  const periodEnd = billingPeriodEnd(sub.startDate, sub.plan.billingPeriod, sub.plan.billingInterval, periodStart);
  // Never invoice past the subscription's own end.
  return { periodStart, periodEnd };
}

/**
 * After billing the period that starts at `sub.nextBillingDate`, schedule the next one.
 * Sets nextBillingDate to null once the next period would start after the expiry date.
 */
export async function advanceBilling(tx: Tx, sub: Pick<DueSubscription, "id" | "startDate" | "expiryDate" | "nextBillingDate" | "plan">): Promise<Date | null> {
  const next = nextBillingDate(sub.startDate, sub.plan.billingPeriod, sub.plan.billingInterval, sub.nextBillingDate!);
  const value = sub.expiryDate && next > sub.expiryDate ? null : next;
  await tx.subscription.update({ where: { id: sub.id }, data: { nextBillingDate: value } });
  return value;
}
