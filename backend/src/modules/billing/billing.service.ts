import { env } from "../../config/env.js";
import { Prisma } from "../../generated/prisma/client.js";
import { toDateOnly, todayUtc } from "../../lib/dates.js";
import { badRequest, domainError, notFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { money } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";
import { pageArgs, pageResult, type Pagination } from "../../lib/shared.js";
import { executeRun, type RunOptions, type RunSummary } from "./engine.js";

/** A RUNNING row older than this is a crashed run, not a live one. */
const STALE_RUN_MS = 30 * 60_000;

export interface StartParams {
  /** user id, or "scheduler" */
  triggeredBy: string;
  asOf?: Date;
  autoConfirm?: boolean;
  /** Bill just this subscription (it must be due). */
  subscriptionId?: string;
  maxInvoices?: number;
}

const runSelect = {
  id: true,
  runDate: true,
  status: true,
  triggeredBy: true,
  scanned: true,
  invoiced: true,
  skipped: true,
  failed: true,
  errors: true,
  startedAt: true,
  finishedAt: true,
} satisfies Prisma.BillingRunSelect;

type RunRow = Prisma.BillingRunGetPayload<{ select: typeof runSelect }>;

const runDto = (r: RunRow) => ({ ...r, runDate: toDateOnly(r.runDate) });

/**
 * Registers a run (and refuses if another full run is genuinely in progress). Returns the RUNNING row.
 * For the scheduler, the unique index on (runDate) WHERE triggeredBy='scheduler' makes this an atomic
 * "first instance wins": the losers get `null` and stand down.
 */
export async function createRun(p: StartParams): Promise<RunRow | null> {
  const asOf = p.asOf ?? todayUtc();
  if (asOf > todayUtc()) throw badRequest("asOf cannot be in the future: invoices are issued on or after their billing date");

  if (!p.subscriptionId) {
    // Mark crashed runs as failed so they can't block billing forever, then refuse if a live one exists.
    await prisma.billingRun.updateMany({
      where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
      data: { status: "FAILED", finishedAt: new Date(), errors: [{ subscription: "(run)", error: "abandoned: no progress for 30 minutes" }] },
    });
    const live = await prisma.billingRun.findFirst({ where: { status: "RUNNING" }, select: { id: true, startedAt: true } });
    if (live) {
      // A person gets told; the scheduler (possibly one of several instances) just stands down quietly.
      if (p.triggeredBy === "scheduler") return null;
      throw domainError("RUN_IN_PROGRESS", "A billing run is already in progress", { runId: live.id, startedAt: live.startedAt });
    }
  }

  try {
    return await prisma.billingRun.create({ data: { runDate: asOf, status: "RUNNING", triggeredBy: p.triggeredBy }, select: runSelect });
  } catch (err) {
    if (p.triggeredBy === "scheduler" && (err as { code?: string }).code === "P2002") return null;
    throw err;
  }
}

/** Run the work for a registered run. Never throws: failures are recorded on the run row. */
export async function runInBackground(run: RunRow, p: StartParams): Promise<RunSummary | null> {
  const opts: RunOptions = {
    asOf: run.runDate,
    autoConfirm: p.autoConfirm ?? false,
    concurrency: env.BILLING_CONCURRENCY,
    maxInvoices: p.maxInvoices ?? 5000,
    only: p.subscriptionId ? [p.subscriptionId] : undefined,
  };
  try {
    return await executeRun(run.id, opts);
  } catch (err) {
    logger.error({ err, runId: run.id }, "billing run failed");
    await prisma.billingRun
      .updateMany({ where: { id: run.id, status: "RUNNING" }, data: { status: "FAILED", finishedAt: new Date(), errors: [{ subscription: "(run)", error: String((err as Error)?.message ?? err).slice(0, 500) }] } })
      .catch(() => undefined);
    return null;
  }
}

// ───────── read side ─────────

export async function listRuns(p: Pagination) {
  const [rows, total] = await Promise.all([prisma.billingRun.findMany({ orderBy: [{ startedAt: "desc" }, { id: "asc" }], select: runSelect, ...pageArgs(p) }), prisma.billingRun.count()]);
  return pageResult(rows.map(runDto), total, p);
}

export async function getRun(id: string) {
  const run = await prisma.billingRun.findUnique({ where: { id }, select: runSelect });
  if (!run) throw notFound("Billing run");
  const [agg] = await prisma.$queryRaw<{ total: Prisma.Decimal | null; confirmed: number }[]>`
    SELECT COALESCE(SUM("total"), 0) AS total, (COUNT(*) FILTER (WHERE "status" <> 'DRAFT'))::int AS confirmed
    FROM "invoices" WHERE "billingRunId" = ${id}::uuid`;
  return { ...runDto(run), invoicedTotal: money(agg?.total), confirmed: agg?.confirmed ?? 0 };
}

/**
 * What a run would do right now: how many subscriptions are due and roughly what they come to
 * (line amounts + tax, before discounts). Read-only; lets staff sanity-check before pressing the button.
 */
export async function preview(asOf: Date = todayUtc()) {
  if (asOf > todayUtc()) throw badRequest("asOf cannot be in the future");
  const day = toDateOnly(asOf);
  const [row] = await prisma.$queryRaw<{ due: number; est: Prisma.Decimal | null; oldest: Date | null }[]>`
    SELECT COUNT(*)::int AS due, COALESCE(SUM(x.est), 0) AS est, MIN(x."nextBillingDate") AS oldest
    FROM (
      SELECT s."id", s."nextBillingDate",
             SUM(sl."amount" + ROUND(sl."amount" * COALESCE(t."ratePercent", 0) / 100, 2)) AS est
      FROM "subscriptions" s
      JOIN "subscription_lines" sl ON sl."subscriptionId" = s."id"
      LEFT JOIN "taxes" t ON t."id" = sl."taxId"
      WHERE s."status" = 'ACTIVE' AND s."nextBillingDate" <= ${day}::date
      GROUP BY s."id", s."nextBillingDate"
    ) x`;
  return { asOf: day, dueSubscriptions: row?.due ?? 0, estimatedTotal: money(row?.est), oldestDue: row?.oldest ? toDateOnly(row.oldest) : null };
}

