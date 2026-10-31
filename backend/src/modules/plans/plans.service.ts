/**
 * Plans & quotation templates.
 *
 * Plan rules worth knowing:
 *  - The billing cycle (period / interval) can't change while subscriptions are billing on the plan: their
 *    schedules are anchored to it, so changing it would silently stretch or shrink their invoice periods. Create a
 *    new plan instead. Everything else (price, flags, availability) can change at any time.
 *  - A plan that subscriptions or templates still use can't be deleted; deactivate it to stop selling it.
 *
 * Template rules: every line must be a live, ACTIVE product (and an active variant OF that product), because a
 * subscription started from the template re-validates them: a template that can't be used is refused up front.
 * `problems` on a template lists anything that has since stopped working (plan retired, product deactivated…).
 */

import { Prisma } from "../../generated/prisma/client.js";
import { toDateOnly, todayUtc } from "../../lib/dates.js";
import { badRequest, conflict, domainError, notFound } from "../../lib/errors.js";
import { D, money, round2, sum } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";
import { pageArgs, pageResult, type Pagination, type Tx } from "../../lib/shared.js";
import type { CreatePlanInput, CreateQuotationTemplateInput, QuotationLineInput, UpdatePlanInput, UpdateQuotationTemplateInput } from "./plans.schemas.js";

const isUnique = (err: unknown) => (err as { code?: string }).code === "P2002";
const stable = [{ createdAt: "desc" as const }, { id: "asc" as const }];
const LIVE_SUBSCRIPTION = { in: ["ACTIVE", "PAUSED"] as ("ACTIVE" | "PAUSED")[] }; // statuses that follow a billing schedule

// ==================== PLANS ====================

const planInclude = { _count: { select: { subscriptions: { where: { status: LIVE_SUBSCRIPTION } } } } } satisfies Prisma.PlanInclude;
type PlanRow = Prisma.PlanGetPayload<{ include: typeof planInclude }>;

const planDto = (p: PlanRow) => ({
  id: p.id,
  name: p.name,
  price: money(p.price),
  billingPeriod: p.billingPeriod,
  billingInterval: p.billingInterval,
  minQuantity: p.minQuantity,
  availableFrom: toDateOnly(p.availableFrom),
  availableUntil: p.availableUntil ? toDateOnly(p.availableUntil) : null,
  autoCloseOnEnd: p.autoCloseOnEnd,
  allowEarlyClose: p.allowEarlyClose,
  allowPause: p.allowPause,
  allowRenewal: p.allowRenewal,
  isActive: p.isActive,
  /** Subscriptions currently billing on this plan (why its billing cycle is locked). */
  liveSubscriptions: p._count.subscriptions,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

export async function createPlan(input: CreatePlanInput) {
  try {
    return planDto(await prisma.plan.create({ data: input, include: planInclude }));
  } catch (err) {
    if (isUnique(err)) throw conflict(`A plan named "${input.name}" already exists`);
    throw err;
  }
}

async function findPlan(id: string) {
  const plan = await prisma.plan.findFirst({ where: { id, deletedAt: null }, include: planInclude });
  if (!plan) throw notFound("Plan");
  return plan;
}

export async function getPlanById(id: string) {
  return planDto(await findPlan(id));
}

export async function listPlans(params: Pagination & { search?: string; billingPeriod?: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"; isActive?: boolean }) {
  const where: Prisma.PlanWhereInput = {
    deletedAt: null,
    ...(params.isActive !== undefined && { isActive: params.isActive }),
    ...(params.billingPeriod && { billingPeriod: params.billingPeriod }),
    ...(params.search && { name: { contains: params.search, mode: "insensitive" } }),
  };
  const [items, total] = await Promise.all([prisma.plan.findMany({ where, include: planInclude, orderBy: stable, ...pageArgs(params) }), prisma.plan.count({ where })]);
  return pageResult(items.map(planDto), total, params);
}

export async function updatePlan(id: string, input: UpdatePlanInput) {
  const existing = await findPlan(id);

  const from = input.availableFrom ?? existing.availableFrom;
  const until = input.availableUntil === undefined ? existing.availableUntil : input.availableUntil;
  if (until && until < from) throw badRequest("availableUntil cannot be before availableFrom");

  const cycleChanges =
    (input.billingPeriod !== undefined && input.billingPeriod !== existing.billingPeriod) ||
    (input.billingInterval !== undefined && input.billingInterval !== existing.billingInterval);
  if (cycleChanges && existing._count.subscriptions > 0) {
    throw domainError(
      "PLAN_IN_USE",
      `${existing._count.subscriptions} subscription(s) are billing on this plan, so its billing cycle can't change. Create a new plan for the new cycle instead.`,
      { liveSubscriptions: existing._count.subscriptions },
    );
  }

  try {
    return planDto(await prisma.plan.update({ where: { id }, data: input, include: planInclude }));
  } catch (err) {
    if (isUnique(err)) throw conflict(`A plan named "${input.name}" already exists`);
    throw err;
  }
}

export async function softDeletePlan(id: string) {
  await findPlan(id);
  const [subscriptions, templates] = await Promise.all([
    prisma.subscription.count({ where: { planId: id, status: { not: "CLOSED" } } }),
    prisma.quotationTemplate.count({ where: { planId: id, deletedAt: null } }),
  ]);
  if (subscriptions || templates) {
    const parts = [subscriptions && `${subscriptions} subscription(s)`, templates && `${templates} quotation template(s)`].filter(Boolean).join(" and ");
    throw domainError("IN_USE", `This plan is still used by ${parts}. Deactivate it instead to stop selling it; existing subscriptions keep billing.`, { subscriptions, templates });
  }
  await prisma.plan.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ==================== QUOTATION TEMPLATES ====================

const templateInclude = {
  plan: true,
  lines: { orderBy: { sortOrder: "asc" }, include: { product: true, variant: true } },
} satisfies Prisma.QuotationTemplateInclude;
type TemplateRow = Prisma.QuotationTemplateGetPayload<{ include: typeof templateInclude }>;

/** Everything that currently stops this template being used (empty = ready). */
function templateProblems(t: TemplateRow, today: Date): string[] {
  const out: string[] = [];
  const p = t.plan;
  if (p.deletedAt || !p.isActive) out.push(`The plan "${p.name}" is no longer active`);
  else if (p.availableFrom > today || (p.availableUntil && p.availableUntil < today)) out.push(`The plan "${p.name}" isn't on sale today`);
  if (t.lines.length === 0) out.push("It has no product lines");
  for (const l of t.lines) {
    if (l.product.deletedAt || !l.product.isActive) out.push(`"${l.product.name}" is no longer sold`);
    if (l.variant && !l.variant.isActive) out.push(`The "${l.variant.attribute}: ${l.variant.value}" variant of "${l.product.name}" is inactive`);
  }
  return out;
}

function templateDto(t: TemplateRow) {
  const lines = t.lines.map((l) => {
    const unit = round2(D(l.product.salesPrice).plus(l.variant?.extraPrice ?? 0));
    return {
      id: l.id,
      productId: l.productId,
      productName: l.product.name,
      variantId: l.variantId,
      variantLabel: l.variant ? `${l.variant.attribute}: ${l.variant.value}` : null,
      quantity: l.quantity,
      sortOrder: l.sortOrder,
      unitPrice: money(unit),
      amount: money(unit.times(l.quantity)),
    };
  });
  const problems = templateProblems(t, todayUtc());
  return {
    id: t.id,
    name: t.name,
    planId: t.planId,
    plan: { id: t.plan.id, name: t.plan.name, billingPeriod: t.plan.billingPeriod, billingInterval: t.plan.billingInterval },
    validityDays: t.validityDays,
    notes: t.notes,
    isActive: t.isActive,
    lines,
    /** Per billing period, before tax and discounts, at today's catalog prices. */
    estimatedUntaxed: money(sum(lines.map((l) => l.amount))),
    usable: problems.length === 0 && t.isActive,
    problems,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/** One batched check for ALL lines (not two queries per line): products live+active, variants active and theirs. */
async function assertLinesUsable(db: Tx, lines: QuotationLineInput[]) {
  if (lines.length === 0) return;
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const variantIds = [...new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v))];
  const [products, variants] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds }, deletedAt: null, isActive: true }, select: { id: true } }),
    variantIds.length ? db.productVariant.findMany({ where: { id: { in: variantIds }, isActive: true }, select: { id: true, productId: true } }) : [],
  ]);
  const okProducts = new Set(products.map((p) => p.id));
  const variantOwner = new Map(variants.map((v) => [v.id, v.productId]));
  lines.forEach((l, i) => {
    if (!okProducts.has(l.productId)) throw badRequest(`lines[${i}]: product not found or inactive`, { line: i, productId: l.productId });
    if (l.variantId && variantOwner.get(l.variantId) !== l.productId) throw badRequest(`lines[${i}]: variant not found, inactive, or not a variant of this product`, { line: i, variantId: l.variantId });
  });
}

async function assertPlanUsable(db: Tx, planId: string) {
  const plan = await db.plan.findFirst({ where: { id: planId, deletedAt: null }, select: { id: true } });
  if (!plan) throw notFound("Plan");
}

const lineRows = (lines: QuotationLineInput[]) => lines.map((l, i) => ({ productId: l.productId, variantId: l.variantId ?? null, quantity: l.quantity, sortOrder: i }));

export async function createQuotationTemplate(input: CreateQuotationTemplateInput) {
  const { lines, ...rest } = input;
  return templateDto(
    await prisma.$transaction(async (tx) => {
      await assertPlanUsable(tx, input.planId);
      await assertLinesUsable(tx, lines);
      return tx.quotationTemplate.create({ data: { ...rest, lines: { create: lineRows(lines) } }, include: templateInclude, relationLoadStrategy: "join" });
    }),
  );
}

async function findTemplate(id: string) {
  const t = await prisma.quotationTemplate.findFirst({ where: { id, deletedAt: null }, include: templateInclude, relationLoadStrategy: "join" });
  if (!t) throw notFound("Quotation template");
  return t;
}

export async function getQuotationTemplateById(id: string) {
  return templateDto(await findTemplate(id));
}

export async function listQuotationTemplates(params: Pagination & { search?: string; planId?: string; isActive?: boolean }) {
  const where: Prisma.QuotationTemplateWhereInput = {
    deletedAt: null,
    ...(params.isActive !== undefined && { isActive: params.isActive }),
    ...(params.planId && { planId: params.planId }),
    ...(params.search && { name: { contains: params.search, mode: "insensitive" } }),
  };
  const [items, total] = await Promise.all([
    prisma.quotationTemplate.findMany({ where, include: templateInclude, relationLoadStrategy: "join", orderBy: stable, ...pageArgs(params) }),
    prisma.quotationTemplate.count({ where }),
  ]);
  return pageResult(items.map(templateDto), total, params);
}

export async function updateQuotationTemplate(id: string, input: UpdateQuotationTemplateInput) {
  const { lines, ...rest } = input;
  return templateDto(
    await prisma.$transaction(async (tx) => {
      const exists = await tx.quotationTemplate.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!exists) throw notFound("Quotation template");
      if (rest.planId) await assertPlanUsable(tx, rest.planId);
      if (lines) {
        await assertLinesUsable(tx, lines);
        await tx.quotationTemplateLine.deleteMany({ where: { templateId: id } });
        if (lines.length) await tx.quotationTemplateLine.createMany({ data: lineRows(lines).map((l) => ({ ...l, templateId: id })) });
      }
      return tx.quotationTemplate.update({ where: { id }, data: rest, include: templateInclude, relationLoadStrategy: "join" });
    }),
  );
}

export async function softDeleteQuotationTemplate(id: string) {
  const t = await prisma.quotationTemplate.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  if (t.count === 0) throw notFound("Quotation template");
}
