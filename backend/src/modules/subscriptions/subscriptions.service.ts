import type { Request } from "express";
import { Prisma, type BillingPeriod, type Plan, type SubscriptionStatus } from "../../generated/prisma/client.js";
import { audit } from "../../lib/audit.js";
import { addDays, billingDateOnOrAfter, nextBillingDate, todayUtc, toDateOnly } from "../../lib/dates.js";
import { badRequest, domainError, forbidden, notFound } from "../../lib/errors.js";
import { money } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";
import { nextDocumentNumber, pageArgs, pageResult, type Tx } from "../../lib/shared.js";
import { auth, type AuthContext } from "../../middleware/auth.js";
import { resolveLines, totalsOf } from "./pricing.js";
import { availableActions, canTransition, EDITABLE_STATUSES, TRANSITIONS, type SubscriptionAction } from "./state-machine.js";
import type {
  CreateSubscriptionInput,
  LineInput,
  ListSubscriptionsQuery,
  TransitionInput,
  UpdateSubscriptionInput,
} from "./subscriptions.schemas.js";

const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

const staleVersion = () =>
  domainError("STALE_VERSION", "This subscription was changed by someone else. Reload it and try again.");

// ───────── scoping ─────────

/** Customers only ever see their own rows; staff see everything. Applied in the QUERY, not after. */
function scope(actor: AuthContext): Prisma.SubscriptionWhereInput {
  if (actor.role !== "CUSTOMER") return {};
  // A customer account with no linked profile matches nothing.
  return { customerId: actor.customerId ?? "00000000-0000-0000-0000-000000000000" };
}

// ───────── read models ─────────

const detailInclude = {
  customer: { select: { id: true, name: true, companyName: true, email: true } },
  plan: true,
  paymentTerm: { select: { id: true, name: true, dueDays: true } },
  lines: {
    orderBy: { sortOrder: "asc" },
    include: {
      product: { select: { name: true } },
      variant: { select: { attribute: true, value: true } },
      tax: { select: { name: true, ratePercent: true } },
    },
  },
  statusHistory: { orderBy: { createdAt: "asc" }, include: { changedBy: { select: { name: true } } } },
} satisfies Prisma.SubscriptionInclude;

type Detail = Prisma.SubscriptionGetPayload<{ include: typeof detailInclude }>;

const d = (v: Date | null) => (v ? toDateOnly(v) : null);

function planDto(p: Plan) {
  return {
    id: p.id,
    name: p.name,
    price: money(p.price),
    billingPeriod: p.billingPeriod,
    billingInterval: p.billingInterval,
    minQuantity: p.minQuantity,
    allowPause: p.allowPause,
    allowEarlyClose: p.allowEarlyClose,
    allowRenewal: p.allowRenewal,
    autoCloseOnEnd: p.autoCloseOnEnd,
  };
}

function detailDto(s: Detail, actor: AuthContext) {
  const isStaff = actor.role !== "CUSTOMER";
  const lines = s.lines.map((l) => {
    const rate = l.tax?.ratePercent ?? 0;
    const t = totalsOf([{ quantity: l.quantity, unitPrice: l.unitPrice, taxRatePercent: rate }]);
    return {
      id: l.id,
      productId: l.productId,
      productName: l.product.name,
      variantId: l.variantId,
      variantLabel: l.variant ? `${l.variant.attribute}: ${l.variant.value}` : null,
      description: l.description,
      quantity: l.quantity,
      unitPrice: money(l.unitPrice),
      taxId: l.taxId,
      taxName: l.tax?.name ?? null,
      taxRatePercent: money(rate),
      amount: money(l.amount),
      taxAmount: money(t.tax),
      total: money(t.total),
    };
  });
  const totals = totalsOf(s.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, taxRatePercent: l.tax?.ratePercent ?? 0 })));

  return {
    id: s.id,
    number: s.number,
    status: s.status,
    version: s.version,
    customer: s.customer,
    plan: planDto(s.plan),
    paymentTerm: s.paymentTerm,
    quotationTemplateId: s.quotationTemplateId,
    startDate: d(s.startDate),
    expiryDate: d(s.expiryDate),
    quoteValidUntil: d(s.quoteValidUntil),
    nextBillingDate: d(s.nextBillingDate),
    activatedAt: s.activatedAt,
    pausedAt: s.pausedAt,
    closedAt: s.closedAt,
    closeReason: s.closeReason,
    ...(isStaff ? { notes: s.notes } : {}),
    lines,
    totals: { untaxed: money(totals.untaxed), tax: money(totals.tax), total: money(totals.total) },
    history: s.statusHistory.map((h) => ({
      from: h.fromStatus,
      to: h.toStatus,
      reason: h.reason,
      by: isStaff ? (h.changedBy?.name ?? null) : null,
      at: h.createdAt,
    })),
    availableActions: availableActions(s.status, actor.role),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

async function loadDetail(id: string, actor: AuthContext, db: Tx = prisma) {
  const s = await db.subscription.findFirst({ where: { id, ...scope(actor) }, include: detailInclude });
  if (!s) throw notFound("Subscription"); // 404 (not 403) so a customer can't probe other people's ids
  return s;
}

export async function getSubscription(req: Request, id: string) {
  const actor = auth(req);
  return detailDto(await loadDetail(id, actor), actor);
}

/** Per-subscription period totals for a page of ids, in one grouped SQL query. */
async function periodTotals(ids: string[]) {
  if (ids.length === 0) return new Map<string, { untaxed: string; tax: string; total: string }>();
  const rows = await prisma.$queryRaw<{ id: string; untaxed: Prisma.Decimal; tax: Prisma.Decimal }[]>`
    SELECT sl."subscriptionId" AS id,
           SUM(sl."amount") AS untaxed,
           SUM(ROUND(sl."amount" * COALESCE(t."ratePercent", 0) / 100, 2)) AS tax
    FROM "subscription_lines" sl
    LEFT JOIN "taxes" t ON t."id" = sl."taxId"
    WHERE sl."subscriptionId" = ANY(${ids}::uuid[])
    GROUP BY sl."subscriptionId"`;
  return new Map(rows.map((r) => [r.id, { untaxed: money(r.untaxed), tax: money(r.tax), total: money(r.untaxed.plus(r.tax)) }]));
}

export async function listSubscriptions(req: Request, q: ListSubscriptionsQuery) {
  const actor = auth(req);
  const where: Prisma.SubscriptionWhereInput = {
    ...scope(actor),
    ...(q.status?.length && { status: { in: q.status } }),
    ...(actor.role !== "CUSTOMER" && q.customerId && { customerId: q.customerId }),
    ...(q.planId && { planId: q.planId }),
    ...((q.startFrom || q.startTo) && { startDate: { ...(q.startFrom && { gte: q.startFrom }), ...(q.startTo && { lte: q.startTo }) } }),
    ...(q.search && {
      OR: [
        { number: { contains: q.search, mode: "insensitive" } },
        ...(actor.role !== "CUSTOMER"
          ? [{ customer: { name: { contains: q.search, mode: "insensitive" as const } } }, { customer: { companyName: { contains: q.search, mode: "insensitive" as const } } }]
          : []),
      ],
    }),
  };
  const dir = q.sort.startsWith("-") ? "desc" : "asc";
  const field = q.sort.replace(/^-/, "") as "createdAt" | "startDate" | "number" | "nextBillingDate";

  const [rows, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      orderBy: [{ [field]: dir }, { id: "asc" }],
      select: {
        id: true,
        number: true,
        status: true,
        startDate: true,
        expiryDate: true,
        nextBillingDate: true,
        createdAt: true,
        customer: { select: { id: true, name: true, companyName: true } },
        plan: { select: { id: true, name: true, billingPeriod: true, billingInterval: true } },
        _count: { select: { lines: true } },
      },
      ...pageArgs(q),
    }),
    prisma.subscription.count({ where }),
  ]);
  const totals = await periodTotals(rows.map((r) => r.id));
  const items = rows.map(({ _count, ...r }) => ({
    ...r,
    startDate: d(r.startDate),
    expiryDate: d(r.expiryDate),
    nextBillingDate: d(r.nextBillingDate),
    lineCount: _count.lines,
    totals: totals.get(r.id) ?? { untaxed: "0.00", tax: "0.00", total: "0.00" },
  }));
  return pageResult(items, total, q);
}

// ───────── form options (staff) ─────────

/**
 * Everything the "new subscription" / line-editor forms need to offer, in ONE round trip:
 * sellable plans, payment terms, active products with their variants, templates and taxes.
 * Read-only and bounded; the catalog CRUD endpoints (Packages 1-2) own editing these.
 */
export async function formOptions() {
  const today = todayUtc();
  const [plans, paymentTerms, products, templates, taxes] = await Promise.all([
    prisma.plan.findMany({
      where: { deletedAt: null, isActive: true, availableFrom: { lte: today }, OR: [{ availableUntil: null }, { availableUntil: { gte: today } }] },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.paymentTerm.findMany({ orderBy: [{ dueDays: "asc" }, { name: "asc" }], take: 100 }),
    prisma.product.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: "asc" },
      take: 1000,
      select: {
        id: true,
        name: true,
        type: true,
        salesPrice: true,
        taxId: true,
        variants: { where: { isActive: true }, orderBy: [{ attribute: "asc" }, { value: "asc" }], select: { id: true, attribute: true, value: true, extraPrice: true } },
      },
    }),
    prisma.quotationTemplate.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, planId: true, validityDays: true, lines: { orderBy: { sortOrder: "asc" }, select: { productId: true, variantId: true, quantity: true } } },
    }),
    prisma.tax.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, ratePercent: true } }),
  ]);

  return {
    plans: plans.map(planDto),
    paymentTerms,
    products: products.map((p) => ({ ...p, salesPrice: money(p.salesPrice), variants: p.variants.map((v) => ({ ...v, extraPrice: money(v.extraPrice) })) })),
    templates,
    taxes: taxes.map((t) => ({ ...t, ratePercent: money(t.ratePercent) })),
  };
}

// ───────── create / edit (staff) ─────────

function assertPlanUsable(plan: { isActive: boolean; deletedAt: Date | null } | null): asserts plan {
  if (!plan || plan.deletedAt || !plan.isActive) throw badRequest("Plan not found or inactive");
}

export async function createSubscription(req: Request, input: CreateSubscriptionInput) {
  const actor = auth(req);
  const today = todayUtc();

  const id = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, deletedAt: null }, select: { id: true } });
    if (!customer) throw badRequest("Customer not found");

    let planId = input.planId;
    let lineInputs: LineInput[] | undefined = input.lines;
    let quoteValidUntil: Date | null = null;

    if (input.quotationTemplateId) {
      const tpl = await tx.quotationTemplate.findFirst({
        where: { id: input.quotationTemplateId, deletedAt: null, isActive: true },
        include: { lines: { orderBy: { sortOrder: "asc" } } },
      });
      if (!tpl) throw badRequest("Quotation template not found or inactive");
      if (planId && planId !== tpl.planId) throw badRequest("planId does not match the quotation template's plan");
      planId = tpl.planId;
      lineInputs ??= tpl.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity }));
      quoteValidUntil = addDays(today, tpl.validityDays);
    }

    const plan = await tx.plan.findUnique({ where: { id: planId! } });
    assertPlanUsable(plan);

    let paymentTermId = input.paymentTermId;
    if (!paymentTermId) {
      paymentTermId = (await tx.paymentTerm.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id;
      if (!paymentTermId) throw badRequest("paymentTermId is required (no default payment term is configured)");
    } else if (!(await tx.paymentTerm.findUnique({ where: { id: paymentTermId }, select: { id: true } }))) {
      throw badRequest("Payment term not found");
    }

    const lines = await resolveLines(tx, lineInputs ?? []);
    const number = await nextDocumentNumber(tx, "SUB");

    const sub = await tx.subscription.create({
      data: {
        number,
        customerId: customer.id,
        planId: plan.id,
        paymentTermId,
        quotationTemplateId: input.quotationTemplateId,
        status: "DRAFT",
        startDate: input.startDate,
        expiryDate: input.expiryDate,
        quoteValidUntil,
        notes: input.notes,
        createdById: actor.userId,
        lines: { create: lines },
        statusHistory: { create: { fromStatus: null, toStatus: "DRAFT", changedById: actor.userId } },
      },
      select: { id: true },
    });
    await audit(req, { action: "subscription.create", entityType: "Subscription", entityId: sub.id, metadata: { number } }, tx);
    return sub.id;
  });
  return detailDto(await loadDetail(id, actor), actor);
}

/** Why did a guarded write match no row? Not found, wrong status, or somebody else edited it first. */
async function explainNoMatch(id: string, expectedVersion: number): Promise<never> {
  const cur = await prisma.subscription.findUnique({ where: { id }, select: { status: true, version: true } });
  if (!cur) throw notFound("Subscription");
  if (cur.version !== expectedVersion) throw staleVersion();
  throw domainError("NOT_EDITABLE", `Only Draft or Quotation subscriptions can be edited (this one is ${cur.status})`);
}

export async function updateSubscription(req: Request, id: string, input: UpdateSubscriptionInput) {
  const actor = auth(req);
  const data: Prisma.SubscriptionUncheckedUpdateManyInput = { version: { increment: 1 } };

  await prisma.$transaction(async (tx) => {
    const cur = await tx.subscription.findUnique({ where: { id }, select: { startDate: true, expiryDate: true } });
    if (!cur) throw notFound("Subscription");

    if (input.planId) {
      assertPlanUsable(await tx.plan.findUnique({ where: { id: input.planId } }));
      data.planId = input.planId;
    }
    if (input.paymentTermId) {
      if (!(await tx.paymentTerm.findUnique({ where: { id: input.paymentTermId }, select: { id: true } }))) throw badRequest("Payment term not found");
      data.paymentTermId = input.paymentTermId;
    }
    const start = input.startDate ?? cur.startDate;
    const expiry = input.expiryDate === undefined ? cur.expiryDate : input.expiryDate;
    if (expiry && expiry < start) throw badRequest("Expiry date must be on or after the start date");
    if (input.startDate) data.startDate = input.startDate;
    if (input.expiryDate !== undefined) data.expiryDate = input.expiryDate;
    if (input.notes !== undefined) data.notes = input.notes;

    const res = await tx.subscription.updateMany({ where: { id, version: input.version, status: { in: EDITABLE_STATUSES } }, data });
    if (res.count !== 1) await explainNoMatch(id, input.version);
    await audit(req, { action: "subscription.update", entityType: "Subscription", entityId: id, metadata: { fields: Object.keys(input).filter((k) => k !== "version") } }, tx);
  });
  return detailDto(await loadDetail(id, actor), actor);
}

export async function replaceLines(req: Request, id: string, version: number, lineInputs: LineInput[]) {
  const actor = auth(req);
  await prisma.$transaction(async (tx) => {
    const lines = await resolveLines(tx, lineInputs);
    // Taking the version first makes concurrent edits fail fast instead of interleaving line writes.
    const res = await tx.subscription.updateMany({ where: { id, version, status: { in: EDITABLE_STATUSES } }, data: { version: { increment: 1 } } });
    if (res.count !== 1) await explainNoMatch(id, version);
    await tx.subscriptionLine.deleteMany({ where: { subscriptionId: id } });
    await tx.subscriptionLine.createMany({ data: lines.map((l) => ({ ...l, subscriptionId: id })) });
    await audit(req, { action: "subscription.replace_lines", entityType: "Subscription", entityId: id, metadata: { lineCount: lines.length } }, tx);
  });
  return detailDto(await loadDetail(id, actor), actor);
}

// ───────── lifecycle ─────────

function assertPlanSellable(plan: Plan, today: Date) {
  if (plan.deletedAt || !plan.isActive) throw domainError("PLAN_UNAVAILABLE", "This plan is no longer active");
  if (plan.availableFrom > today || (plan.availableUntil && plan.availableUntil < today)) {
    throw domainError("PLAN_UNAVAILABLE", "This plan is not available for sale on today's date");
  }
}

/** The next date a live subscription should be billed: continues after the last invoiced period. */
async function resumeBillingDate(tx: Tx, sub: { id: string; startDate: Date; expiryDate: Date | null }, plan: { billingPeriod: BillingPeriod; billingInterval: number }, today: Date) {
  const last = await tx.invoice.aggregate({ where: { subscriptionId: sub.id, status: { not: "CANCELLED" } }, _max: { periodStart: true } });
  let next: Date;
  if (last._max.periodStart) {
    next = nextBillingDate(sub.startDate, plan.billingPeriod, plan.billingInterval, last._max.periodStart);
  } else {
    // Never billed: start on the schedule's first date that is not in the past (no automatic back-billing).
    next = billingDateOnOrAfter(sub.startDate, plan.billingPeriod, plan.billingInterval, today);
  }
  return sub.expiryDate && next > sub.expiryDate ? null : next;
}

export async function transition(req: Request, id: string, input: TransitionInput) {
  const actor = auth(req);
  const action: SubscriptionAction = input.action;
  const rule = TRANSITIONS[action];
  if (!rule.roles.includes(actor.role)) throw forbidden(`Your role cannot ${action.replace("_", " ")} a subscription`);
  if (rule.reasonRequired && !input.reason) throw badRequest("A reason is required");

  const now = new Date();
  const today = todayUtc(now);

  await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findFirst({ where: { id, ...scope(actor) }, include: { plan: true, lines: { select: { quantity: true } } } });
    if (!sub) throw notFound("Subscription");
    if (sub.version !== input.version) throw staleVersion();
    if (!canTransition(action, sub.status)) {
      throw domainError("INVALID_TRANSITION", `Cannot ${action.replace("_", " ")} a subscription that is ${sub.status}`, { status: sub.status, action });
    }
    const { plan } = sub;
    if (rule.planFlag && !plan[rule.planFlag]) {
      throw domainError("PLAN_RULE", `The "${plan.name}" plan does not allow this (${rule.planFlag})`, { rule: rule.planFlag });
    }
    if (rule.needsLines && sub.lines.length === 0) throw domainError("NO_LINES", "Add at least one product line first");

    // `renew` only extends the expiry: an ACTIVE or PAUSED subscription keeps its status.
    const toStatus: SubscriptionStatus = action === "renew" ? sub.status : rule.to;
    const data: Prisma.SubscriptionUncheckedUpdateManyInput = { status: toStatus, version: { increment: 1 } };

    switch (action) {
      case "send_quotation":
        assertPlanSellable(plan, today);
        if (!sub.quoteValidUntil) data.quoteValidUntil = addDays(today, DEFAULT_QUOTE_VALIDITY_DAYS);
        break;

      case "confirm": {
        if (sub.quoteValidUntil && sub.quoteValidUntil < today) {
          throw domainError("QUOTE_EXPIRED", `This quotation expired on ${toDateOnly(sub.quoteValidUntil)}`);
        }
        assertPlanSellable(plan, today);
        const qty = sub.lines.reduce((n, l) => n + l.quantity, 0);
        if (qty < plan.minQuantity) {
          throw domainError("MIN_QUANTITY", `This plan needs a total quantity of at least ${plan.minQuantity} (currently ${qty})`, { minQuantity: plan.minQuantity, quantity: qty });
        }
        break;
      }

      case "activate":
        data.activatedAt = now;
        data.nextBillingDate = await resumeBillingDate(tx, sub, plan, today);
        break;

      case "pause":
        data.pausedAt = now;
        break;

      case "resume":
        data.pausedAt = null;
        // Paused periods are not billed retroactively.
        data.nextBillingDate = await resumeBillingDate(tx, sub, plan, today);
        break;

      case "close": {
        const live = sub.status === "ACTIVE" || sub.status === "PAUSED";
        const ended = sub.expiryDate !== null && sub.expiryDate <= today;
        if (live && !ended && !plan.allowEarlyClose) {
          throw domainError("PLAN_RULE", `The "${plan.name}" plan cannot be closed before its expiry date`, { rule: "allowEarlyClose" });
        }
        data.closedAt = now;
        data.closeReason = input.reason;
        data.nextBillingDate = null;
        break;
      }

      case "renew": {
        if (!sub.expiryDate) throw domainError("NO_EXPIRY", "This subscription has no expiry date to renew");
        if (!input.expiryDate) throw badRequest("expiryDate (the new expiry) is required to renew");
        if (input.expiryDate <= sub.expiryDate) throw badRequest("The new expiry date must be after the current one", { current: toDateOnly(sub.expiryDate) });
        data.expiryDate = input.expiryDate;
        // Billing may have stopped because the old expiry was reached; pick the schedule back up.
        if (sub.status === "ACTIVE" && !sub.nextBillingDate) {
          data.nextBillingDate = await resumeBillingDate(tx, { ...sub, expiryDate: input.expiryDate }, plan, today);
        }
        break;
      }
    }

    // Compare-and-swap on (version, status): a concurrent change makes this match nothing.
    const res = await tx.subscription.updateMany({ where: { id, version: input.version, status: sub.status }, data });
    if (res.count !== 1) throw staleVersion();

    await tx.subscriptionStatusHistory.create({
      data: {
        subscriptionId: id,
        fromStatus: sub.status,
        toStatus,
        reason: action === "renew" ? `Renewed to ${input.expiryDate ? toDateOnly(input.expiryDate) : ""}${input.reason ? ` – ${input.reason}` : ""}` : input.reason,
        changedById: actor.userId,
      },
    });
    await audit(req, { action: `subscription.${action}`, entityType: "Subscription", entityId: id, metadata: { from: sub.status, to: toStatus } }, tx);
  });
  return detailDto(await loadDetail(id, actor), actor);
}

// ───────── maintenance (called by the scheduler / admin) ─────────

/**
 * Closes live subscriptions whose plan has `autoCloseOnEnd` and whose expiry date has passed.
 * Idempotent and safe to run concurrently (rows are claimed with SKIP LOCKED). Returns how many closed.
 */
export async function closeExpiredSubscriptions(
  asOf: Date = todayUtc(),
  opts: { batchSize?: number; /** restrict to these ids (tests) */ subscriptionIds?: string[] } = {},
): Promise<number> {
  const batchSize = opts.batchSize ?? 500;
  const only = opts.subscriptionIds ? Prisma.sql`AND s."id" = ANY(${opts.subscriptionIds}::uuid[])` : Prisma.empty;
  let closed = 0;
  for (;;) {
    const n = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; status: SubscriptionStatus }[]>`
        SELECT s."id", s."status"
        FROM "subscriptions" s JOIN "plans" p ON p."id" = s."planId"
        WHERE s."status" IN ('ACTIVE', 'PAUSED') AND p."autoCloseOnEnd"
          AND s."expiryDate" IS NOT NULL AND s."expiryDate" < ${toDateOnly(asOf)}::date ${only}
        ORDER BY s."expiryDate", s."id"
        LIMIT ${batchSize}
        FOR UPDATE OF s SKIP LOCKED`;
      if (rows.length === 0) return 0;
      const now = new Date();
      await tx.subscription.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { status: "CLOSED", closedAt: now, closeReason: "Plan ended (auto-closed)", nextBillingDate: null, version: { increment: 1 } },
      });
      await tx.subscriptionStatusHistory.createMany({
        data: rows.map((r) => ({ subscriptionId: r.id, fromStatus: r.status, toStatus: "CLOSED" as const, reason: "Plan ended (auto-closed)" })),
      });
      return rows.length;
    });
    closed += n;
    if (n < batchSize) return closed;
  }
}
