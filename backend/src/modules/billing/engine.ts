// The billing engine: turns due subscriptions into invoices, safely, repeatedly and in parallel.
//
// Guarantees (each one is covered by an integration test):
//  * NOTHING BILLED TWICE  - one invoice per (subscription, period): checked in the transaction AND enforced by a
//    partial unique index, so even a bug or a second server cannot create a duplicate.
//  * NOTHING SKIPPED       - a subscription's schedule only advances in the SAME transaction that created its invoice;
//    anything that fails rolls back whole and stays due for the next run. Late subscriptions catch up period by period.
//  * SAFE IN PARALLEL      - subscriptions are claimed with FOR UPDATE SKIP LOCKED, so workers (and servers) never collide.
//  * ONE BAD ROW CAN'T STOP THE RUN - each invoice is its own transaction; failures are recorded and the run moves on.
//  * LIMITED PROMOTIONS HOLD - discount usage is a guarded atomic UPDATE; if a discount ran out under our feet the invoice is
//    rebuilt without it.

import { Prisma, type BillingRunStatus } from "../../generated/prisma/client.js";
import { addDays, toDateOnly } from "../../lib/dates.js";
import { logger } from "../../lib/logger.js";
import { D, type Decimal } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";
import type { Tx } from "../../lib/shared.js";
import { advanceBilling, claimDueSubscriptions, currentPeriod, type DueSubscription } from "../subscriptions/subscriptions.billing.js";
import { confirmDraft } from "../invoices/lifecycle.js";
import { computeInvoice, isRuleLive, type DiscountRule } from "./calc.js";

// ───────── errors & outcomes ─────────

/** A promotion hit its usage limit between reading it and redeeming it. Triggers one rebuild without it. */
export class DiscountExhausted extends Error {
  constructor(public readonly discountId: string) {
    super(`discount ${discountId} has no uses left`);
  }
}

/** Anything that went wrong for one subscription, tagged so the run can record it and move on. */
export class BillingFailure extends Error {
  constructor(
    public readonly subscriptionId: string,
    public readonly subscriptionNumber: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

export type Outcome =
  | { kind: "none" }
  | { kind: "invoiced"; subscriptionId: string; invoiceId: string; total: Decimal; confirmed: boolean }
  | { kind: "skipped"; subscriptionId: string; reason: string }
  | { kind: "failed"; subscriptionId: string; subscriptionNumber: string; error: string };

// ───────── discount rules ─────────

type DiscountRow = Prisma.DiscountGetPayload<{ include: { products: { select: { productId: true } } } }>;

function toRule(d: DiscountRow): DiscountRule {
  return {
    id: d.id,
    type: d.type,
    value: d.value,
    scope: d.scope,
    minPurchaseAmount: d.minPurchaseAmount,
    minQuantity: d.minQuantity,
    productIds: new Set(d.products.map((p) => p.productId)),
  };
}

/** Product-scoped discounts live on `onDate`. Loaded ONCE per run, not per invoice. */
export async function loadProductRules(db: Tx, onDate: Date): Promise<DiscountRow[]> {
  const rows = await db.discount.findMany({
    where: { scope: "PRODUCT", isActive: true, deletedAt: null, startDate: { lte: onDate }, OR: [{ endDate: null }, { endDate: { gte: onDate } }] },
    include: { products: { select: { productId: true } } },
  });
  return rows.filter((r) => isRuleLive(r, onDate));
}

// ───────── building one invoice ─────────

export interface BuildContext {
  /** Invoice issue date (the run date). */
  issueDate: Date;
  billingRunId: string | null;
  productRules: DiscountRow[];
  /** Discounts found used-up during this run: don't try them again. */
  exhausted: Set<string>;
  autoConfirm: boolean;
}

/**
 * Creates the invoice for `period` inside the caller's transaction: lines with tax, applicable discounts redeemed
 * (guarded), customer details snapshotted. Does NOT touch the subscription's schedule.
 */
export async function createInvoiceForPeriod(tx: Tx, sub: DueSubscription, period: { periodStart: Date; periodEnd: Date }, ctx: BuildContext) {
  if (sub.lines.length === 0) throw new Error("subscription has no lines to bill");

  // Which discounts apply today: matching product discounts + the ones attached to this subscription.
  const productIds = new Set(sub.lines.map((l) => l.productId));
  const candidates = new Map<string, DiscountRow>();
  for (const r of ctx.productRules) if (r.products.some((p) => productIds.has(p.productId))) candidates.set(r.id, r);
  for (const a of sub.discounts) if (a.discount.scope === "SUBSCRIPTION" && isRuleLive(a.discount, ctx.issueDate)) candidates.set(a.discount.id, a.discount);
  const rules = [...candidates.values()].filter((r) => !ctx.exhausted.has(r.id)).map(toRule);

  const calc = computeInvoice(
    sub.lines.map((l) => ({ key: l.id, quantity: l.quantity, unitPrice: l.unitPrice, productId: l.productId, taxRatePercent: l.tax?.ratePercent ?? 0 })),
    rules,
  );
  const byKey = new Map(calc.lines.map((l) => [l.key, l]));
  const c = sub.customer;

  const invoice = await tx.invoice.create({
    data: {
      subscriptionId: sub.id,
      customerId: sub.customerId,
      billingRunId: ctx.billingRunId,
      status: "DRAFT",
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      issueDate: ctx.issueDate,
      dueDate: addDays(ctx.issueDate, sub.paymentTerm.dueDays),
      subtotal: calc.subtotal,
      discountTotal: calc.discountTotal,
      taxTotal: calc.taxTotal,
      total: calc.total,
      // Snapshot: later edits to the customer never rewrite an issued invoice.
      billToName: c.companyName || c.name,
      billToEmail: c.email,
      billToAddress: c.billingAddress === null ? Prisma.DbNull : (c.billingAddress as Prisma.InputJsonValue),
      billToTaxId: c.taxId,
      lines: {
        create: sub.lines.map((l, i) => {
          const r = byKey.get(l.id)!;
          return {
            productId: l.productId,
            variantId: l.variantId,
            description: l.description || l.product.name,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            discountAmount: r.discountAmount,
            taxRatePercent: r.taxRatePercent,
            taxAmount: r.taxAmount,
            lineTotal: r.lineTotal,
            sortOrder: i,
          };
        }),
      },
    },
    select: { id: true, total: true },
  });

  // Redeem each discount that actually applied: ONE statement that consumes a use and records the redemption.
  // The WHERE clause is the limit enforcement: under concurrency exactly `usageLimit` invoices can ever win it,
  // no matter how many workers race. Losing means the discount ran out under our feet → rebuild without it.
  for (const a of calc.applied) {
    const recorded = await tx.$executeRaw`
      WITH won AS (
        UPDATE "discounts" SET "usedCount" = "usedCount" + 1, "updatedAt" = now()
        WHERE "id" = ${a.discountId}::uuid AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")
        RETURNING "id"
      )
      INSERT INTO "discount_redemptions" ("id", "discountId", "invoiceId", "subscriptionId", "amount", "createdAt")
      SELECT gen_random_uuid(), won."id", ${invoice.id}::uuid, ${sub.id}::uuid, ${a.amount.toFixed(2)}::numeric, now() FROM won`;
    if (recorded !== 1) throw new DiscountExhausted(a.discountId);
  }

  if (ctx.autoConfirm) await confirmDraft(tx, invoice.id);
  return { id: invoice.id, total: invoice.total, confirmed: ctx.autoConfirm };
}

// ───────── billing one due subscription ─────────

export interface WorkerOptions {
  asOf: Date;
  billingRunId: string | null;
  autoConfirm: boolean;
  productRules: DiscountRow[];
  exhausted: Set<string>;
  /** Subscriptions that already failed in this run. */
  failed: Set<string>;
  only?: string[];
}

/**
 * Claims ONE due subscription, bills its current period and moves its schedule forward: all in one transaction.
 * Returns what happened; "none" means nothing (more) is due.
 */
export async function billNext(o: WorkerOptions): Promise<Outcome> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx): Promise<Outcome> => {
          const [sub] = await claimDueSubscriptions(tx, o.asOf, 1, { exclude: [...o.failed], only: o.only });
          if (!sub) return { kind: "none" };

          try {
            const period = currentPeriod(sub);

            // Already invoiced for this period (created by hand, or this run was interrupted after the invoice but before the
            // schedule moved)? Don't bill again; just make sure the schedule moves on so it isn't claimed forever.
            if (sub.alreadyBilled) {
              await advanceBilling(tx, sub);
              return { kind: "skipped", subscriptionId: sub.id, reason: `period starting ${toDateOnly(period.periodStart)} is already invoiced` };
            }

            const invoice = await createInvoiceForPeriod(tx, sub, period, {
              issueDate: o.asOf,
              billingRunId: o.billingRunId,
              productRules: o.productRules,
              exhausted: o.exhausted,
              autoConfirm: o.autoConfirm,
            });
            await advanceBilling(tx, sub);
            return { kind: "invoiced", subscriptionId: sub.id, invoiceId: invoice.id, total: invoice.total, confirmed: invoice.confirmed };
          } catch (err) {
            if (err instanceof DiscountExhausted) throw err;
            throw new BillingFailure(sub.id, sub.number, err);
          }
        },
        { timeout: 30_000, maxWait: 30_000 },
      );
    } catch (err) {
      if (err instanceof DiscountExhausted) {
        o.exhausted.add(err.discountId); // everything rolled back; rebuild without that discount
        continue;
      }
      if (err instanceof BillingFailure) {
        logger.error({ err, subscription: err.subscriptionNumber }, "billing failed for subscription");
        o.failed.add(err.subscriptionId);
        return { kind: "failed", subscriptionId: err.subscriptionId, subscriptionNumber: err.subscriptionNumber, error: err.message.slice(0, 500) };
      }
      throw err; // infrastructure problem (db down…): the whole run should know
    }
  }
  throw new Error("billing retried too many times because discounts kept running out");
}

// ───────── a whole run ─────────

export interface RunOptions {
  asOf: Date;
  autoConfirm: boolean;
  concurrency: number;
  /** Upper bound on invoices per run so one run can't go on forever; the rest is picked up next run. */
  maxInvoices: number;
  /** Bill only these subscriptions. */
  only?: string[];
}

export interface RunSummary {
  scanned: number;
  invoiced: number;
  skipped: number;
  failed: number;
  confirmed: number;
  total: string;
  errors: { subscriptionId: string; subscription: string; error: string }[];
  truncated: boolean;
}

const MAX_RECORDED_ERRORS = 200;

/** Process everything that is due. Updates the BillingRun row (counters + final status) as it goes. */
export async function executeRun(runId: string, o: RunOptions): Promise<RunSummary> {
  const productRules = await loadProductRules(prisma, o.asOf);
  const worker: WorkerOptions = { asOf: o.asOf, billingRunId: runId, autoConfirm: o.autoConfirm, productRules, exhausted: new Set(), failed: new Set(), only: o.only };
  const s: RunSummary = { scanned: 0, invoiced: 0, skipped: 0, failed: 0, confirmed: 0, total: "0", errors: [], truncated: false };
  let total: Decimal = D(0);
  let budget = o.maxInvoices;
  let fatal: unknown = null;

  const loop = async () => {
    while (budget > 0 && !fatal) {
      budget--;
      let out: Outcome;
      try {
        out = await billNext(worker);
      } catch (err) {
        fatal = err; // infrastructure failure: stop all workers, record it
        return;
      }
      if (out.kind === "none") {
        budget++;
        return;
      }
      s.scanned++;
      if (out.kind === "invoiced") {
        s.invoiced++;
        total = total.plus(out.total);
        if (out.confirmed) s.confirmed++;
      } else if (out.kind === "skipped") s.skipped++;
      else {
        s.failed++;
        if (s.errors.length < MAX_RECORDED_ERRORS) s.errors.push({ subscriptionId: out.subscriptionId, subscription: out.subscriptionNumber, error: out.error });
      }
    }
  };

  await Promise.all(Array.from({ length: o.concurrency }, loop));
  s.truncated = budget <= 0;
  s.total = total.toFixed(2);

  const status: BillingRunStatus = fatal ? "FAILED" : s.failed > 0 ? "PARTIAL" : "COMPLETED";
  const errors = fatal ? [...s.errors, { subscriptionId: "", subscription: "(run)", error: String((fatal as Error)?.message ?? fatal).slice(0, 500) }] : s.errors;
  await prisma.billingRun.update({
    where: { id: runId },
    data: {
      status,
      scanned: s.scanned,
      invoiced: s.invoiced,
      skipped: s.skipped,
      failed: s.failed,
      errors: errors.length ? (errors as Prisma.InputJsonValue) : Prisma.DbNull,
      finishedAt: new Date(),
    },
  });
  if (fatal) throw fatal;
  return s;
}
