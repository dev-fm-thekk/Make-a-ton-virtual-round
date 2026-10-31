/**
 * Discount rules: admin-managed CRUD, product / subscription attachment, and usage reporting.
 *
 * What this module does NOT do: calculate or redeem discounts. Applying them to an invoice (ordering, stacking, rounding,
 * the guarded usage counter) is the billing engine's job (modules/billing/calc.ts + engine.ts), so there is exactly ONE
 * implementation of the money maths. This module only maintains the rules the engine reads, and must never touch `usedCount`.
 */

import type { Prisma } from "../../generated/prisma/client.js";
import { toDateOnly, todayUtc } from "../../lib/dates.js";
import { badRequest, conflict, domainError, notFound } from "../../lib/errors.js";
import { money } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";
import { pageArgs, pageResult, type Pagination, type Tx } from "../../lib/shared.js";
import { discountStatus, remainingUses } from "./derive.js";
import type { CreateDiscountInput, ListDiscountsQuery, UpdateDiscountInput } from "./discounts.schemas.js";

const stable = [{ createdAt: "desc" as const }, { id: "asc" as const }];
const isUnique = (err: unknown) => (err as { code?: string }).code === "P2002";

const include = {
  products: { select: { product: { select: { id: true, name: true } } } },
  _count: { select: { subscriptions: true, redemptions: true } },
} satisfies Prisma.DiscountInclude;
type Row = Prisma.DiscountGetPayload<{ include: typeof include }>;

export function discountDto(d: Row, today = todayUtc()) {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    value: money(d.value),
    scope: d.scope,
    minPurchaseAmount: d.minPurchaseAmount === null ? null : money(d.minPurchaseAmount),
    minQuantity: d.minQuantity,
    startDate: toDateOnly(d.startDate),
    endDate: d.endDate ? toDateOnly(d.endDate) : null,
    usageLimit: d.usageLimit,
    usedCount: d.usedCount,
    remainingUses: remainingUses(d),
    isActive: d.isActive,
    /** Why it is / isn't being applied today. */
    status: discountStatus(d, today),
    products: d.products.map((p) => p.product),
    attachedSubscriptions: d._count.subscriptions,
    redemptions: d._count.redemptions,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

async function find(id: string, db: Tx = prisma) {
  const d = await db.discount.findFirst({ where: { id, deletedAt: null }, include, relationLoadStrategy: "join" });
  if (!d) throw notFound("Discount");
  return d;
}

/** Every product id must be a live product (one batched query). */
async function assertProducts(db: Tx, ids: string[]) {
  if (ids.length === 0) return;
  const found = await db.product.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
  const ok = new Set(found.map((p) => p.id));
  const missing = ids.filter((id) => !ok.has(id));
  if (missing.length) throw notFound(`Product ${missing[0]}`);
}

// ==================== CRUD ====================

export async function createDiscount(input: CreateDiscountInput) {
  const { productIds, ...rest } = input;
  const id = await prisma.$transaction(async (tx) => {
    await assertProducts(tx, productIds);
    const d = await tx.discount.create({ data: { ...rest, products: { create: productIds.map((productId) => ({ productId })) } }, select: { id: true } });
    return d.id;
  });
  return discountDto(await find(id));
}

export async function getDiscountById(id: string) {
  return discountDto(await find(id));
}

/** "What is happening to it today" as a database filter (so pagination stays correct). */
function statusWhere(status: NonNullable<ListDiscountsQuery["status"]>, today: Date): Prisma.DiscountWhereInput {
  const started = { startDate: { lte: today } };
  const notEnded = { OR: [{ endDate: null }, { endDate: { gte: today } }] };
  switch (status) {
    case "inactive":
      return { isActive: false };
    case "scheduled":
      return { isActive: true, startDate: { gt: today } };
    case "expired":
      return { isActive: true, endDate: { lt: today } };
    case "exhausted":
      return { isActive: true, ...started, AND: [notEnded, { usageLimit: { not: null } }, { usedCount: { gte: prisma.discount.fields.usageLimit } }] };
    case "active":
      return { isActive: true, ...started, AND: [notEnded, { OR: [{ usageLimit: null }, { usedCount: { lt: prisma.discount.fields.usageLimit } }] }] };
  }
}

export async function listDiscounts(params: Pagination & Omit<ListDiscountsQuery, "page" | "limit">) {
  const today = todayUtc();
  const where: Prisma.DiscountWhereInput = {
    deletedAt: null,
    ...(params.isActive !== undefined && { isActive: params.isActive }),
    ...(params.scope && { scope: params.scope }),
    ...(params.type && { type: params.type }),
    ...(params.search && { name: { contains: params.search, mode: "insensitive" } }),
    ...(params.status && statusWhere(params.status, today)),
  };
  const [items, total] = await Promise.all([prisma.discount.findMany({ where, include, relationLoadStrategy: "join", orderBy: stable, ...pageArgs(params) }), prisma.discount.count({ where })]);
  return pageResult(items.map((d) => discountDto(d, today)), total, params);
}

export async function updateDiscount(id: string, input: UpdateDiscountInput) {
  const { productIds, ...fields } = input;

  await prisma.$transaction(async (tx) => {
    // Lock the row: a billing worker redeeming this discount right now would otherwise race our `usedCount` check.
    await tx.$queryRaw`SELECT "id" FROM "discounts" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const existing = await find(id, tx);

    // Validate the row as it WILL look, not just the fields that were sent.
    const type = fields.type ?? existing.type;
    const scope = fields.scope ?? existing.scope;
    const value = fields.value ?? existing.value.toString();
    const start = fields.startDate ?? existing.startDate;
    const end = fields.endDate === undefined ? existing.endDate : fields.endDate;
    const limit = fields.usageLimit === undefined ? existing.usageLimit : fields.usageLimit;
    const active = fields.isActive ?? existing.isActive;

    if (type === "PERCENTAGE" && Number(value) > 100) throw badRequest("A percentage can't be more than 100", { field: "value" });
    if (end && end < start) throw badRequest("endDate cannot be before startDate", { field: "endDate" });
    if (limit !== null && limit < existing.usedCount) {
      throw domainError("USAGE_BELOW_USED", `It has already been used ${existing.usedCount} time(s), so the limit can't be lower than that.`, { usedCount: existing.usedCount });
    }

    // Changing scope would orphan whatever is attached for the old scope.
    if (scope !== existing.scope) {
      if (existing.scope === "PRODUCT" && productIds === undefined && existing.products.length)
        throw domainError("SCOPE_CHANGE_BLOCKED", "Remove the discount's products before switching it to a subscription discount (send productIds: []).");
      if (existing.scope === "SUBSCRIPTION" && existing._count.subscriptions)
        throw domainError("SCOPE_CHANGE_BLOCKED", `Detach it from its ${existing._count.subscriptions} subscription(s) before making it a product discount.`, { subscriptions: existing._count.subscriptions });
    }

    let productCount = existing.products.length;
    if (productIds !== undefined) {
      if (scope === "SUBSCRIPTION" && productIds.length) throw badRequest("productIds only apply to PRODUCT-scoped discounts");
      await assertProducts(tx, productIds);
      await tx.discountProduct.deleteMany({ where: { discountId: id } });
      if (productIds.length) await tx.discountProduct.createMany({ data: productIds.map((productId) => ({ discountId: id, productId })) });
      productCount = productIds.length;
    } else if (scope !== existing.scope && scope === "SUBSCRIPTION") {
      productCount = 0;
    }
    if (scope === "PRODUCT" && active && productCount === 0) throw badRequest("An active product discount needs at least one product");

    await tx.discount.update({ where: { id }, data: fields });
  });
  return discountDto(await find(id));
}

/** Soft delete. The billing engine ignores deleted discounts, so attached ones simply stop applying. */
export async function softDeleteDiscount(id: string) {
  const res = await prisma.discount.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), isActive: false } });
  if (res.count === 0) throw notFound("Discount");
}

// ==================== PRODUCT ATTACHMENT ====================

export async function attachProductsToDiscount(discountId: string, productIds: string[]) {
  await prisma.$transaction(async (tx) => {
    const d = await find(discountId, tx);
    if (d.scope !== "PRODUCT") throw badRequest("Products can only be attached to PRODUCT-scoped discounts");
    await assertProducts(tx, productIds);
    await tx.discountProduct.createMany({ data: productIds.map((productId) => ({ discountId, productId })), skipDuplicates: true });
  });
  return discountDto(await find(discountId));
}

export async function detachProductFromDiscount(discountId: string, productId: string) {
  await prisma.$transaction(async (tx) => {
    const d = await find(discountId, tx);
    const has = d.products.some((p) => p.product.id === productId);
    if (has && d.isActive && d.products.length === 1) {
      throw domainError("LAST_PRODUCT", "That is the discount's only product. Deactivate the discount first, or attach another product.");
    }
    await tx.discountProduct.deleteMany({ where: { discountId, productId } });
  });
}

// ==================== SUBSCRIPTION ATTACHMENT ====================

export async function attachDiscountToSubscription(discountId: string, subscriptionId: string) {
  const d = await find(discountId);
  if (d.scope !== "SUBSCRIPTION") throw badRequest("Only SUBSCRIPTION-scoped discounts can be attached to a subscription");
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId }, select: { status: true } });
  if (!sub) throw notFound("Subscription");
  if (sub.status === "CLOSED") throw domainError("SUBSCRIPTION_CLOSED", "That subscription is closed");
  try {
    await prisma.subscriptionDiscount.create({ data: { discountId, subscriptionId } });
  } catch (err) {
    if (isUnique(err)) throw conflict("That discount is already attached to this subscription");
    throw err;
  }
  return discountDto(await find(discountId));
}

export async function detachDiscountFromSubscription(discountId: string, subscriptionId: string) {
  await prisma.subscriptionDiscount.deleteMany({ where: { discountId, subscriptionId } });
}

/** Discounts attached to one subscription (for its detail page). Deleted ones are hidden: they no longer apply. */
export async function discountsForSubscription(subscriptionId: string) {
  const rows = await prisma.subscriptionDiscount.findMany({
    where: { subscriptionId, discount: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    include: { discount: { include } },
  });
  return rows.map((r) => ({ attachedAt: r.createdAt, discount: discountDto(r.discount) }));
}

// ==================== USAGE REPORTING ====================

/** Where a discount has actually been used: one row per invoice it reduced. */
export async function listRedemptions(discountId: string, params: Pagination) {
  await find(discountId);
  const where = { discountId };
  const [rows, total] = await Promise.all([
    prisma.discountRedemption.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        amount: true,
        createdAt: true,
        invoice: { select: { id: true, number: true, status: true, customer: { select: { id: true, name: true } } } },
        subscription: { select: { id: true, number: true } },
      },
      ...pageArgs(params),
    }),
    prisma.discountRedemption.count({ where }),
  ]);
  return pageResult(
    rows.map((r) => ({ id: r.id, amount: money(r.amount), at: r.createdAt, invoice: { id: r.invoice.id, number: r.invoice.number, status: r.invoice.status }, customer: r.invoice.customer, subscription: r.subscription })),
    total,
    params,
  );
}

