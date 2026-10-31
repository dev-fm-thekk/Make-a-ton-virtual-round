// ──────────────────────────────────────────────────────────────────────────────
// Billing contract (consumed by Package 6 – the billing engine). Everything here must run
// INSIDE the engine's per-subscription transaction so the claim, the invoice and the schedule
// advance commit (or roll back) together.
//
//   1. claimDueSubscriptions(tx, asOf, n)  – lock up to n due ACTIVE subscriptions (SKIP LOCKED: safe on N workers)
//   2. …build + insert the invoice for sub.nextBillingDate (unique (subscriptionId, periodStart) prevents doubles)
//   3. advanceBilling(tx, sub)             – move nextBillingDate to the next scheduled date (or null at expiry)
// ──────────────────────────────────────────────────────────────────────────────

import { Prisma } from "../../generated/prisma/client.js";
import { billingPeriodEnd, nextBillingDate, toDateOnly } from "../../lib/dates.js";
import type { Tx } from "../../lib/shared.js";

const claimInclude = {
  customer: true,
  plan: true,
  paymentTerm: true,
  lines: { orderBy: { sortOrder: "asc" as const }, include: { product: { select: { name: true } }, variant: true, tax: true } },
  discounts: { include: { discount: { include: { products: true } } } },
};

export interface ClaimOptions {
  /** Skip these (subscriptions that already failed in this run, so they aren't retried in a loop). */
  exclude?: string[];
  /** Only consider these (targeted billing of one subscription). */
  only?: string[];
}

/**
 * Locks and returns subscriptions due for invoicing on `asOf`, oldest due date first.
 * Rows stay locked until the surrounding transaction ends; concurrent workers skip them.
 */
export async function claimDueSubscriptions(tx: Tx, asOf: Date, limit: number, opts: ClaimOptions = {}) {
  const exclude = opts.exclude?.length ? Prisma.sql`AND s."id" <> ALL(${opts.exclude}::uuid[])` : Prisma.empty;
  const only = opts.only?.length ? Prisma.sql`AND s."id" = ANY(${opts.only}::uuid[])` : Prisma.empty;
  // One round trip: lock the rows AND learn whether each period already has a live invoice
  // (the engine then skips instead of double-billing, without a second query per subscription).
  const ids = await tx.$queryRaw<{ id: string; alreadyBilled: boolean }[]>`
    SELECT s."id",
           EXISTS (SELECT 1 FROM "invoices" i WHERE i."subscriptionId" = s."id" AND i."periodStart" = s."nextBillingDate" AND i."status" <> 'CANCELLED') AS "alreadyBilled"
    FROM "subscriptions" s
    WHERE s."status" = 'ACTIVE' AND s."nextBillingDate" <= ${toDateOnly(asOf)}::date ${exclude} ${only}
    ORDER BY s."nextBillingDate", s."id"
    LIMIT ${limit}
    FOR UPDATE OF s SKIP LOCKED`;
  if (ids.length === 0) return [];
  // relationLoadStrategy "join": the whole object graph in ONE query instead of one per relation.
  const subs = await tx.subscription.findMany({ where: { id: { in: ids.map((r) => r.id) } }, include: claimInclude, relationLoadStrategy: "join" });
  const order = new Map(ids.map((r, i) => [r.id, i]));
  const billed = new Map(ids.map((r) => [r.id, r.alreadyBilled]));
  return subs.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map((sub) => ({ ...sub, alreadyBilled: billed.get(sub.id) ?? false }));
}

export type DueSubscription = Awaited<ReturnType<typeof claimDueSubscriptions>>[number];

/** The invoice period being billed for a claimed subscription: [periodStart, periodEnd]. */
export function currentPeriod(sub: Pick<DueSubscription, "startDate" | "nextBillingDate" | "expiryDate" | "plan">) {
  const periodStart = sub.nextBillingDate!;
  const naturalEnd = billingPeriodEnd(sub.startDate, sub.plan.billingPeriod, sub.plan.billingInterval, periodStart);
  // Never invoice past the subscription's own end (the last period is not prorated, only shortened on paper).
  const periodEnd = sub.expiryDate && sub.expiryDate < naturalEnd ? sub.expiryDate : naturalEnd;
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

/** Row-lock one subscription and load everything an invoice needs (used to re-issue a period outside the due-queue). */
export async function lockSubscriptionForBilling(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "subscriptions" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const sub = await tx.subscription.findUnique({ where: { id }, include: claimInclude, relationLoadStrategy: "join" });
  return sub && { ...sub, alreadyBilled: false };
}
