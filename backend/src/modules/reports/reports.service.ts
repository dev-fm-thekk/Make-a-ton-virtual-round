// Read-only reporting. Rules that keep every endpoint fast on thousands of rows:
//  * aggregate IN SQL (SUM/COUNT/GROUP BY) – never load rows into Node to add them up;
//  * filters hit indexed columns / the partial indexes from the constraints migration;
//  * lists are paginated (max 100) and also return totals computed over the WHOLE filtered set;
//  * dates cross into SQL as 'YYYY-MM-DD' strings (never JS Dates) so the server's time zone can't shift a day.
//
// Conventions (documented for the finance team):
//  * "Today" and all day boundaries are UTC.
//  * An invoice is OVERDUE when status = CONFIRMED (sent, not fully paid) and dueDate < today.
//  * Revenue = payments received (by payment date). Invoiced = CONFIRMED + PAID invoices (by issue date).
//  * MRR = ACTIVE subscriptions' line amounts (before tax and discounts) normalised to a month.

import { Prisma } from "../../generated/prisma/client.js";
import { addDays, diffDays, toDateOnly, todayUtc } from "../../lib/dates.js";
import { money } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";
import { pageArgs, pageResult, type Tx } from "../../lib/shared.js";
import {
  endOfDay,
  type InvoicesQuery,
  type OverdueQuery,
  type PaymentsQuery,
  type RevenueQuery,
  type SubscriptionsReportQuery,
  type SummaryQuery,
} from "./reports.schemas.js";

const sql = Prisma.sql;
type Db = Tx;
type Dec = Prisma.Decimal | null;

/** Billing periods per calendar month for a plan row aliased `p` (365.25/12 days, 52.1775/12 weeks). */
const PERIODS_PER_MONTH = sql`(CASE p."billingPeriod"
    WHEN 'DAILY' THEN 30.4375 WHEN 'WEEKLY' THEN 4.348125 WHEN 'MONTHLY' THEN 1 WHEN 'YEARLY' THEN 1.0 / 12 END
    / p."billingInterval")`;

const where = (conds: Prisma.Sql[]) => (conds.length ? sql`WHERE ${Prisma.join(conds, " AND ")}` : Prisma.empty);
const iso = (d: Date) => toDateOnly(d);
const asOfOrToday = (d?: Date) => d ?? todayUtc();

// ───────────────────────── summary ─────────────────────────

export async function summary(q: SummaryQuery, db: Db = prisma) {
  const from = iso(q.from);
  const to = iso(q.to);
  const asOf = iso(todayUtc());

  const [byStatus, mrr, collected, invoiced, open, activity] = await Promise.all([
    db.$queryRaw<{ status: string; n: number }[]>`SELECT "status"::text AS status, COUNT(*)::int AS n FROM "subscriptions" GROUP BY "status"`,

    db.$queryRaw<{ mrr: Dec }[]>`
      SELECT COALESCE(SUM(sl."amount" * ${PERIODS_PER_MONTH}), 0) AS mrr
      FROM "subscriptions" s
      JOIN "plans" p ON p."id" = s."planId"
      JOIN "subscription_lines" sl ON sl."subscriptionId" = s."id"
      WHERE s."status" = 'ACTIVE'`,

    db.$queryRaw<{ amount: Dec; n: number }[]>`
      SELECT COALESCE(SUM("amount"), 0) AS amount, COUNT(*)::int AS n FROM "payments"
      WHERE "paidAt" >= (${from}::date)::timestamp AT TIME ZONE 'UTC'
        AND "paidAt" <  ((${to}::date + 1))::timestamp AT TIME ZONE 'UTC'`,

    db.$queryRaw<{ total: Dec; n: number; paid_n: number }[]>`
      SELECT COALESCE(SUM("total"), 0) AS total, COUNT(*)::int AS n, (COUNT(*) FILTER (WHERE "status" = 'PAID'))::int AS paid_n
      FROM "invoices"
      WHERE "status" IN ('CONFIRMED', 'PAID') AND "issueDate" BETWEEN ${from}::date AND ${to}::date`,

    // Snapshot of what is still owed right now (uses the partial index on CONFIRMED invoices).
    db.$queryRaw<{ n: number; outstanding: Dec; overdue_n: number; overdue_amount: Dec }[]>`
      SELECT COUNT(*)::int AS n,
             COALESCE(SUM("total" - "amountPaid"), 0) AS outstanding,
             (COUNT(*) FILTER (WHERE "dueDate" < ${asOf}::date))::int AS overdue_n,
             COALESCE(SUM("total" - "amountPaid") FILTER (WHERE "dueDate" < ${asOf}::date), 0) AS overdue_amount
      FROM "invoices" WHERE "status" = 'CONFIRMED'`,

    db.$queryRaw<{ activated: number; closed: number }[]>`
      SELECT (COUNT(*) FILTER (WHERE "activatedAt" >= (${from}::date)::timestamp AT TIME ZONE 'UTC'
                                 AND "activatedAt" < ((${to}::date + 1))::timestamp AT TIME ZONE 'UTC'))::int AS activated,
             (COUNT(*) FILTER (WHERE "closedAt" >= (${from}::date)::timestamp AT TIME ZONE 'UTC'
                                 AND "closedAt" < ((${to}::date + 1))::timestamp AT TIME ZONE 'UTC'))::int AS closed
      FROM "subscriptions"
      WHERE "activatedAt" >= (${from}::date)::timestamp AT TIME ZONE 'UTC' OR "closedAt" >= (${from}::date)::timestamp AT TIME ZONE 'UTC'`,
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
  const monthly = mrr[0]?.mrr ?? new Prisma.Decimal(0);
  const c = collected[0]!;
  const i = invoiced[0]!;
  const o = open[0]!;
  const a = activity[0] ?? { activated: 0, closed: 0 };

  return {
    range: { from, to },
    asOf,
    subscriptions: {
      active: statusCounts.ACTIVE ?? 0,
      byStatus: { DRAFT: 0, QUOTATION: 0, CONFIRMED: 0, ACTIVE: 0, PAUSED: 0, CLOSED: 0, ...statusCounts },
      activatedInRange: a.activated,
      closedInRange: a.closed,
    },
    recurringRevenue: { mrr: money(monthly), arr: money(monthly.times(12)) },
    revenue: { collected: money(c.amount), payments: c.n }, // money that actually came in
    invoiced: { total: money(i.total), invoices: i.n, paidInFull: i.paid_n },
    outstanding: {
      amount: money(o.outstanding),
      invoices: o.n,
      overdueAmount: money(o.overdue_amount),
      overdueInvoices: o.overdue_n,
    },
  };
}

// ───────────────────────── revenue time-series ─────────────────────────

export async function revenueSeries(q: RevenueQuery, db: Db = prisma) {
  const from = iso(q.from);
  const to = iso(q.to);
  const unit = q.groupBy; // enum-validated; bound as a parameter anyway

  // generate_series gives every bucket (even empty ones) so charts have no gaps.
  const rows = await db.$queryRaw<{ bucket: Date; collected: Dec; payments: number; invoiced: Dec; invoices: number }[]>`
    WITH buckets AS (
      SELECT generate_series(date_trunc(${unit}, ${from}::date)::date, date_trunc(${unit}, ${to}::date)::date, ('1 ' || ${unit})::interval)::date AS bucket
    ),
    collected AS (
      SELECT date_trunc(${unit}, "paidAt" AT TIME ZONE 'UTC')::date AS bucket, SUM("amount") AS amount, COUNT(*)::int AS n
      FROM "payments"
      WHERE "paidAt" >= (${from}::date)::timestamp AT TIME ZONE 'UTC' AND "paidAt" < ((${to}::date + 1))::timestamp AT TIME ZONE 'UTC'
      GROUP BY 1
    ),
    invoiced AS (
      SELECT date_trunc(${unit}, "issueDate")::date AS bucket, SUM("total") AS total, COUNT(*)::int AS n
      FROM "invoices"
      WHERE "status" IN ('CONFIRMED', 'PAID') AND "issueDate" BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1
    )
    SELECT b.bucket, COALESCE(c.amount, 0) AS collected, COALESCE(c.n, 0) AS payments,
           COALESCE(i.total, 0) AS invoiced, COALESCE(i.n, 0) AS invoices
    FROM buckets b
    LEFT JOIN collected c ON c.bucket = b.bucket
    LEFT JOIN invoiced i ON i.bucket = b.bucket
    ORDER BY b.bucket`;

  const points = rows.map((r) => ({ bucket: iso(r.bucket), collected: money(r.collected), payments: r.payments, invoiced: money(r.invoiced), invoices: r.invoices }));
  const totals = rows.reduce(
    (t, r) => ({ collected: t.collected.plus(r.collected ?? 0), invoiced: t.invoiced.plus(r.invoiced ?? 0) }),
    { collected: new Prisma.Decimal(0), invoiced: new Prisma.Decimal(0) },
  );
  return { range: { from, to }, groupBy: unit, points, totals: { collected: money(totals.collected), invoiced: money(totals.invoiced) } };
}

// ───────────────────────── overdue ─────────────────────────

export async function overdue(q: OverdueQuery, db: Db = prisma) {
  const asOfDate = asOfOrToday(q.asOf);
  const asOf = iso(asOfDate);

  const conds: Prisma.Sql[] = [sql`"status" = 'CONFIRMED'`, sql`"dueDate" < ${asOf}::date`];
  if (q.customerId) conds.push(sql`"customerId" = ${q.customerId}::uuid`);

  const [aging] = await db.$queryRaw<
    { n: number; amount: Dec; b1_n: number; b1: Dec; b2_n: number; b2: Dec; b3_n: number; b3: Dec; b4_n: number; b4: Dec }[]
  >`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(bal), 0) AS amount,
      (COUNT(*) FILTER (WHERE days BETWEEN 1 AND 30))::int  AS b1_n, COALESCE(SUM(bal) FILTER (WHERE days BETWEEN 1 AND 30), 0)  AS b1,
      (COUNT(*) FILTER (WHERE days BETWEEN 31 AND 60))::int AS b2_n, COALESCE(SUM(bal) FILTER (WHERE days BETWEEN 31 AND 60), 0) AS b2,
      (COUNT(*) FILTER (WHERE days BETWEEN 61 AND 90))::int AS b3_n, COALESCE(SUM(bal) FILTER (WHERE days BETWEEN 61 AND 90), 0) AS b3,
      (COUNT(*) FILTER (WHERE days > 90))::int              AS b4_n, COALESCE(SUM(bal) FILTER (WHERE days > 90), 0)              AS b4
    FROM (SELECT (${asOf}::date - "dueDate") AS days, ("total" - "amountPaid") AS bal FROM "invoices" ${where(conds)}) x`;

  const listWhere: Prisma.InvoiceWhereInput = {
    status: "CONFIRMED",
    dueDate: { lt: asOfDate, ...(q.minDaysOverdue && { lte: addDays(asOfDate, -q.minDaysOverdue) }) },
    ...(q.customerId && { customerId: q.customerId }),
  };
  // "-balance" needs a computed column Prisma can't order by; total is the closest stable proxy for a page of open invoices.
  const orderBy: Prisma.InvoiceOrderByWithRelationInput = q.sort === "-dueDate" ? { dueDate: "desc" } : q.sort === "-balance" ? { total: "desc" } : { dueDate: "asc" };

  const [rows, total] = await Promise.all([
    db.invoice.findMany({
      where: listWhere,
      orderBy: [orderBy, { id: "asc" }],
      select: {
        id: true,
        number: true,
        issueDate: true,
        dueDate: true,
        total: true,
        amountPaid: true,
        customer: { select: { id: true, name: true, companyName: true, email: true } },
        subscription: { select: { id: true, number: true } },
      },
      ...pageArgs(q),
    }),
    db.invoice.count({ where: listWhere }),
  ]);

  const a = aging ?? { n: 0, amount: null, b1_n: 0, b1: null, b2_n: 0, b2: null, b3_n: 0, b3: null, b4_n: 0, b4: null };
  return {
    asOf,
    summary: {
      invoices: a.n,
      amount: money(a.amount),
      aging: [
        { bucket: "1-30", invoices: a.b1_n, amount: money(a.b1) },
        { bucket: "31-60", invoices: a.b2_n, amount: money(a.b2) },
        { bucket: "61-90", invoices: a.b3_n, amount: money(a.b3) },
        { bucket: "90+", invoices: a.b4_n, amount: money(a.b4) },
      ],
    },
    ...pageResult(
      rows.map((r) => ({
        id: r.id,
        number: r.number,
        customer: r.customer,
        subscription: r.subscription,
        issueDate: iso(r.issueDate),
        dueDate: iso(r.dueDate),
        daysOverdue: diffDays(asOfDate, r.dueDate),
        total: money(r.total),
        amountPaid: money(r.amountPaid),
        balance: money(r.total.minus(r.amountPaid)),
      })),
      total,
      q,
    ),
  };
}

// ───────────────────────── invoices (paid / outstanding / overdue) ─────────────────────────

export async function invoices(q: InvoicesQuery, db: Db = prisma) {
  const asOfDate = asOfOrToday(q.asOf);

  const status: Prisma.InvoiceWhereInput =
    q.state === "paid" ? { status: "PAID" } : q.state === "all" ? { status: { in: ["CONFIRMED", "PAID"] } } : { status: "CONFIRMED", ...(q.state === "overdue" && { dueDate: { lt: asOfDate } }) };

  const w: Prisma.InvoiceWhereInput = {
    ...status,
    ...((q.from || q.to) && { issueDate: { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) } }),
    ...(q.customerId && { customerId: q.customerId }),
    ...(q.subscriptionId && { subscriptionId: q.subscriptionId }),
    ...(q.search && { OR: [{ number: { contains: q.search, mode: "insensitive" } }, { billToName: { contains: q.search, mode: "insensitive" } }] }),
  };
  const dir = q.sort.startsWith("-") ? "desc" : "asc";
  const field = q.sort.replace(/^-/, "") as "issueDate" | "dueDate" | "total";

  const [rows, count, totals] = await Promise.all([
    db.invoice.findMany({
      where: w,
      orderBy: [{ [field]: dir }, { id: "asc" }],
      select: {
        id: true,
        number: true,
        status: true,
        issueDate: true,
        dueDate: true,
        total: true,
        amountPaid: true,
        customer: { select: { id: true, name: true, companyName: true } },
        subscription: { select: { id: true, number: true } },
      },
      ...pageArgs(q),
    }),
    db.invoice.count({ where: w }),
    db.invoice.aggregate({ where: w, _sum: { total: true, amountPaid: true } }),
  ]);

  const items = rows.map((r) => {
    const paymentState = r.status === "PAID" ? "paid" : r.dueDate < asOfDate ? "overdue" : "outstanding";
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      paymentState,
      customer: r.customer,
      subscription: r.subscription,
      issueDate: iso(r.issueDate),
      dueDate: iso(r.dueDate),
      daysOverdue: paymentState === "overdue" ? diffDays(asOfDate, r.dueDate) : 0,
      total: money(r.total),
      amountPaid: money(r.amountPaid),
      balance: money(r.total.minus(r.amountPaid)),
    };
  });
  const sumTotal = totals._sum.total ?? new Prisma.Decimal(0);
  const sumPaid = totals._sum.amountPaid ?? new Prisma.Decimal(0);
  return {
    asOf: iso(asOfDate),
    totals: { invoices: count, total: money(sumTotal), paid: money(sumPaid), balance: money(sumTotal.minus(sumPaid)) },
    ...pageResult(items, count, q),
  };
}

// ───────────────────────── payments ─────────────────────────

export async function payments(q: PaymentsQuery, db: Db = prisma) {
  const w: Prisma.PaymentWhereInput = {
    ...((q.from || q.to) && { paidAt: { ...(q.from && { gte: q.from }), ...(q.to && { lt: endOfDay(q.to) }) } }),
    ...(q.method && { method: q.method }),
    ...(q.customerId && { invoice: { customerId: q.customerId } }),
    ...(q.search && {
      OR: [
        { reference: { contains: q.search, mode: "insensitive" } },
        { invoice: { number: { contains: q.search, mode: "insensitive" } } },
        { invoice: { billToName: { contains: q.search, mode: "insensitive" } } },
      ],
    }),
  };
  const dir = q.sort.startsWith("-") ? "desc" : "asc";
  const field = q.sort.replace(/^-/, "") as "paidAt" | "amount";

  const [rows, count, byMethod, totals] = await Promise.all([
    db.payment.findMany({
      where: w,
      orderBy: [{ [field]: dir }, { id: "asc" }],
      select: {
        id: true,
        method: true,
        amount: true,
        paidAt: true,
        reference: true,
        note: true,
        invoice: { select: { id: true, number: true, customer: { select: { id: true, name: true, companyName: true } } } },
      },
      ...pageArgs(q),
    }),
    db.payment.count({ where: w }),
    db.payment.groupBy({ by: ["method"], where: w, _sum: { amount: true }, _count: { _all: true } }),
    db.payment.aggregate({ where: w, _sum: { amount: true } }),
  ]);

  return {
    totals: { payments: count, amount: money(totals._sum.amount) },
    byMethod: byMethod.map((m) => ({ method: m.method, payments: m._count._all, amount: money(m._sum.amount) })),
    ...pageResult(
      rows.map((r) => ({
        id: r.id,
        method: r.method,
        amount: money(r.amount),
        paidAt: r.paidAt,
        reference: r.reference,
        note: r.note,
        invoice: { id: r.invoice.id, number: r.invoice.number },
        customer: r.invoice.customer,
      })),
      count,
      q,
    ),
  };
}

// ───────────────────────── subscriptions ─────────────────────────

export async function subscriptionsReport(q: SubscriptionsReportQuery, db: Db = prisma) {
  // Filters shared by the list and the by-status breakdown (the breakdown ignores the status filter itself).
  const base: Prisma.Sql[] = [];
  if (q.planId) base.push(sql`s."planId" = ${q.planId}::uuid`);
  if (q.customerId) base.push(sql`s."customerId" = ${q.customerId}::uuid`);
  if (q.startFrom) base.push(sql`s."startDate" >= ${iso(q.startFrom)}::date`);
  if (q.startTo) base.push(sql`s."startDate" <= ${iso(q.startTo)}::date`);
  const listConds = [...base];
  if (q.status?.length) listConds.push(sql`s."status" = ANY(${q.status}::"SubscriptionStatus"[])`);

  // enum-validated → safe to inline as identifiers
  const order = {
    "-mrr": sql`mrr DESC`,
    mrr: sql`mrr ASC`,
    "-startDate": sql`s."startDate" DESC`,
    startDate: sql`s."startDate" ASC`,
  }[q.sort];
  const { skip, take } = pageArgs(q);

  const [rows, byStatus, mrrByPlan] = await Promise.all([
    db.$queryRaw<
      {
        id: string; number: string; status: string; startDate: Date; expiryDate: Date | null; nextBillingDate: Date | null;
        customerId: string; customerName: string; planId: string; planName: string; billingPeriod: string; billingInterval: number;
        untaxed: Dec; mrr: Dec; total: number;
      }[]
    >`
      SELECT s."id", s."number", s."status"::text AS status, s."startDate", s."expiryDate", s."nextBillingDate",
             c."id" AS "customerId", c."name" AS "customerName",
             p."id" AS "planId", p."name" AS "planName", p."billingPeriod"::text AS "billingPeriod", p."billingInterval",
             COALESCE(l.amt, 0) AS untaxed,
             CASE WHEN s."status" = 'ACTIVE' THEN COALESCE(l.amt, 0) * ${PERIODS_PER_MONTH} ELSE 0 END AS mrr,
             (COUNT(*) OVER())::int AS total
      FROM "subscriptions" s
      JOIN "customers" c ON c."id" = s."customerId"
      JOIN "plans" p ON p."id" = s."planId"
      LEFT JOIN LATERAL (SELECT SUM(sl."amount") AS amt FROM "subscription_lines" sl WHERE sl."subscriptionId" = s."id") l ON TRUE
      ${where(listConds)}
      ORDER BY ${order}, s."id"
      LIMIT ${take} OFFSET ${skip}`,

    db.$queryRaw<{ status: string; n: number }[]>`
      SELECT s."status"::text AS status, COUNT(*)::int AS n FROM "subscriptions" s ${where(base)} GROUP BY s."status"`,

    db.$queryRaw<{ planId: string; planName: string; subscriptions: number; mrr: Dec }[]>`
      SELECT p."id" AS "planId", p."name" AS "planName", COUNT(DISTINCT s."id")::int AS subscriptions,
             COALESCE(SUM(sl."amount" * ${PERIODS_PER_MONTH}), 0) AS mrr
      FROM "subscriptions" s
      JOIN "plans" p ON p."id" = s."planId"
      JOIN "subscription_lines" sl ON sl."subscriptionId" = s."id"
      ${where([...base, sql`s."status" = 'ACTIVE'`])}
      GROUP BY p."id", p."name"
      ORDER BY mrr DESC`,
  ]);

  const total = rows[0]?.total ?? 0;
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
  return {
    summary: {
      byStatus: { DRAFT: 0, QUOTATION: 0, CONFIRMED: 0, ACTIVE: 0, PAUSED: 0, CLOSED: 0, ...counts },
      mrrByPlan: mrrByPlan.map((r) => ({ planId: r.planId, planName: r.planName, subscriptions: r.subscriptions, mrr: money(r.mrr) })),
      mrr: money(mrrByPlan.reduce((t, r) => t.plus(r.mrr ?? 0), new Prisma.Decimal(0))),
    },
    ...pageResult(
      rows.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        customer: { id: r.customerId, name: r.customerName },
        plan: { id: r.planId, name: r.planName, billingPeriod: r.billingPeriod, billingInterval: r.billingInterval },
        startDate: iso(r.startDate),
        expiryDate: r.expiryDate ? iso(r.expiryDate) : null,
        nextBillingDate: r.nextBillingDate ? iso(r.nextBillingDate) : null,
        amountPerPeriod: money(r.untaxed),
        mrr: money(r.mrr),
      })),
      total,
      q,
    ),
  };
}
