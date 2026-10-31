/**
 * Discounts Service
 *
 * Implements Module 5 (Discounts):
 * - Admin-only CRUD for discounts (fixed or percentage, min purchase/quantity, usage limits, date range).
 * - Attaching discounts to products (DiscountProduct) and to subscriptions (SubscriptionDiscount).
 * - Guarded atomic usage increment for redemption:
 *     UPDATE discounts SET "usedCount" = "usedCount" + 1
 *     WHERE id = $1 AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")
 * - Pure function exported for Package 6 (Billing engine):
 *     findApplicableDiscounts(lines, subscription, asOf)
 */

import { Prisma, type Discount, type DiscountType, type DiscountScope } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { notFound, badRequest, conflict } from "../../lib/errors.js";
import { pageArgs, pageResult, type Pagination, type Tx } from "../../lib/shared.js";

// ==================== INTERFACES ====================

export interface CreateDiscountInput {
  name: string;
  type: DiscountType;
  value: string;
  scope: DiscountScope;
  minPurchaseAmount?: string | null;
  minQuantity?: number | null;
  startDate: string;
  endDate?: string | null;
  usageLimit?: number | null;
  isActive?: boolean;
  productIds?: string[];
}

export interface UpdateDiscountInput {
  name?: string;
  type?: DiscountType;
  value?: string;
  scope?: DiscountScope;
  minPurchaseAmount?: string | null;
  minQuantity?: number | null;
  startDate?: string;
  endDate?: string | null;
  usageLimit?: number | null;
  isActive?: boolean;
  productIds?: string[];
}

export interface BillableLineItem {
  id?: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
}

export interface BillableSubscription {
  id: string;
  customerId: string;
  discounts?: {
    discountId: string;
    discount?: Discount;
  }[];
}

export interface ApplicableDiscountResult {
  discount: Discount;
  discountAmount: Prisma.Decimal;
  lineId?: string;
  productId?: string;
  scope: DiscountScope;
}

const discountInclude = {
  products: {
    include: {
      product: true,
    },
  },
  _count: {
    select: {
      subscriptions: true,
      redemptions: true,
    },
  },
} as const;

// ==================== DISCOUNT CRUD ====================

export async function createDiscount(input: CreateDiscountInput) {
  const start = new Date(input.startDate);
  const end = input.endDate ? new Date(input.endDate) : null;
  if (end && end < start) {
    throw badRequest("endDate cannot be before startDate");
  }

  const valDecimal = new Prisma.Decimal(input.value);
  if (input.type === "PERCENTAGE" && (valDecimal.lessThan(0) || valDecimal.greaterThan(100))) {
    throw badRequest("Percentage discount value must be between 0 and 100");
  }

  return prisma.$transaction(async (tx) => {
    // If productIds are supplied for PRODUCT-scoped discount, verify they exist
    if (input.productIds && input.productIds.length > 0) {
      if (input.scope !== "PRODUCT") {
        throw badRequest("productIds can only be specified for PRODUCT-scoped discounts");
      }
      for (const pid of input.productIds) {
        const prod = await tx.product.findFirst({ where: { id: pid, deletedAt: null } });
        if (!prod) throw notFound(`Product ${pid}`);
      }
    }

    const discount = await tx.discount.create({
      data: {
        name: input.name,
        type: input.type,
        value: valDecimal,
        scope: input.scope,
        minPurchaseAmount: input.minPurchaseAmount ? new Prisma.Decimal(input.minPurchaseAmount) : null,
        minQuantity: input.minQuantity ?? null,
        startDate: start,
        endDate: end,
        usageLimit: input.usageLimit ?? null,
        isActive: input.isActive ?? true,
        ...(input.productIds && input.productIds.length > 0 && {
          products: {
            create: input.productIds.map((pid) => ({ productId: pid })),
          },
        }),
      },
      include: discountInclude,
    });

    return discount;
  });
}

export async function getDiscountById(id: string) {
  const discount = await prisma.discount.findFirst({
    where: { id, deletedAt: null },
    include: discountInclude,
  });
  if (!discount) throw notFound("Discount");
  return discount;
}

export async function listDiscounts(
  params: Pagination & {
    search?: string;
    scope?: DiscountScope;
    type?: DiscountType;
    isActive?: boolean;
  },
) {
  const where: Prisma.DiscountWhereInput = {
    deletedAt: null,
    ...(params.isActive !== undefined && { isActive: params.isActive }),
    ...(params.scope && { scope: params.scope }),
    ...(params.type && { type: params.type }),
    ...(params.search && {
      name: { contains: params.search, mode: "insensitive" },
    }),
  };

  const [items, total] = await Promise.all([
    prisma.discount.findMany({
      where,
      include: discountInclude,
      orderBy: { createdAt: "desc" },
      ...pageArgs(params),
    }),
    prisma.discount.count({ where }),
  ]);

  return pageResult(items, total, params);
}

export async function updateDiscount(id: string, input: UpdateDiscountInput) {
  const existing = await getDiscountById(id);

  const start = input.startDate ? new Date(input.startDate) : existing.startDate;
  const end = input.endDate !== undefined ? (input.endDate ? new Date(input.endDate) : null) : existing.endDate;
  if (end && end < start) {
    throw badRequest("endDate cannot be before startDate");
  }

  const effectiveType = input.type ?? existing.type;
  if (input.value !== undefined) {
    const valDecimal = new Prisma.Decimal(input.value);
    if (effectiveType === "PERCENTAGE" && (valDecimal.lessThan(0) || valDecimal.greaterThan(100))) {
      throw badRequest("Percentage discount value must be between 0 and 100");
    }
  }

  return prisma.$transaction(async (tx) => {
    if (input.productIds !== undefined) {
      const scope = input.scope ?? existing.scope;
      if (scope !== "PRODUCT" && input.productIds.length > 0) {
        throw badRequest("productIds can only be specified for PRODUCT-scoped discounts");
      }
      for (const pid of input.productIds) {
        const prod = await tx.product.findFirst({ where: { id: pid, deletedAt: null } });
        if (!prod) throw notFound(`Product ${pid}`);
      }
      await tx.discountProduct.deleteMany({ where: { discountId: id } });
      if (input.productIds.length > 0) {
        await tx.discountProduct.createMany({
          data: input.productIds.map((pid) => ({ discountId: id, productId: pid })),
        });
      }
    }

    return tx.discount.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.value !== undefined && { value: new Prisma.Decimal(input.value) }),
        ...(input.scope !== undefined && { scope: input.scope }),
        ...(input.minPurchaseAmount !== undefined && {
          minPurchaseAmount: input.minPurchaseAmount ? new Prisma.Decimal(input.minPurchaseAmount) : null,
        }),
        ...(input.minQuantity !== undefined && { minQuantity: input.minQuantity }),
        ...(input.startDate !== undefined && { startDate: start }),
        ...(input.endDate !== undefined && { endDate: end }),
        ...(input.usageLimit !== undefined && { usageLimit: input.usageLimit }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
      include: discountInclude,
    });
  });
}

export async function softDeleteDiscount(id: string) {
  await getDiscountById(id);
  return prisma.discount.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ==================== ATTACHMENTS ====================

export async function attachProductsToDiscount(discountId: string, productIds: string[]) {
  const discount = await getDiscountById(discountId);
  if (discount.scope !== "PRODUCT") {
    throw badRequest("Can only attach products to PRODUCT-scoped discounts");
  }

  return prisma.$transaction(async (tx) => {
    for (const pid of productIds) {
      const prod = await tx.product.findFirst({ where: { id: pid, deletedAt: null } });
      if (!prod) throw notFound(`Product ${pid}`);
      await tx.discountProduct.upsert({
        where: { discountId_productId: { discountId, productId: pid } },
        create: { discountId, productId: pid },
        update: {},
      });
    }

    return tx.discount.findUnique({
      where: { id: discountId },
      include: discountInclude,
    });
  });
}

export async function detachProductFromDiscount(discountId: string, productId: string) {
  await getDiscountById(discountId);
  return prisma.discountProduct.deleteMany({
    where: { discountId, productId },
  });
}

export async function attachDiscountToSubscription(discountId: string, subscriptionId: string) {
  const discount = await getDiscountById(discountId);
  if (discount.scope !== "SUBSCRIPTION") {
    throw badRequest("Can only attach SUBSCRIPTION-scoped discounts to subscriptions");
  }

  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) throw notFound("Subscription");

  try {
    return await prisma.subscriptionDiscount.create({
      data: {
        discountId,
        subscriptionId,
      },
      include: {
        discount: true,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw conflict("Discount is already attached to this subscription");
    }
    throw err;
  }
}

export async function detachDiscountFromSubscription(discountId: string, subscriptionId: string) {
  return prisma.subscriptionDiscount.deleteMany({
    where: { discountId, subscriptionId },
  });
}

// ==================== GUARDED REDEMPTION (Hard Rule) ====================

/**
 * Atomically reserves a usage slot on a discount.
 * Rule: UPDATE discounts SET "usedCount" = "usedCount" + 1
 *       WHERE id = $1 AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")
 * Returns true if slot was claimed, false if usageLimit was reached.
 */
export async function redeemDiscountGuarded(tx: Tx, discountId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ count: bigint }[]>`
    WITH updated AS (
      UPDATE "discounts"
      SET "usedCount" = "usedCount" + 1, "updatedAt" = now()
      WHERE "id" = ${discountId}::uuid
        AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")
        AND "isActive" = true
        AND "deletedAt" IS NULL
      RETURNING "id"
    )
    SELECT count(*)::bigint as count FROM updated;
  `;

  const count = Number(rows[0]?.count ?? 0);
  return count > 0;
}

// ==================== CROSS-PACKAGE PURE FUNCTION (Hard Rule) ====================

/**
 * Pure function to calculate applicable discounts for lines and subscription as of a date.
 * Package 6 calls this pure function during billing runs.
 */
export function findApplicableDiscounts(
  lines: BillableLineItem[],
  subscription: BillableSubscription,
  asOf: Date = new Date(),
  availableDiscounts: (Discount & { products?: { productId: string }[] })[] = [],
): ApplicableDiscountResult[] {
  const results: ApplicableDiscountResult[] = [];
  const dateOnly = new Date(asOf.toISOString().split("T")[0]!);

  // Helper to check validity dates and usage limits
  const isValid = (d: Discount) => {
    if (!d.isActive || d.deletedAt) return false;
    const start = new Date(d.startDate.toISOString().split("T")[0]!);
    if (dateOnly < start) return false;
    if (d.endDate) {
      const end = new Date(d.endDate.toISOString().split("T")[0]!);
      if (dateOnly > end) return false;
    }
    if (d.usageLimit !== null && d.usedCount >= d.usageLimit) return false;
    return true;
  };

  // 1. PRODUCT-SCOPED DISCOUNTS
  const productDiscounts = availableDiscounts.filter((d) => d.scope === "PRODUCT" && isValid(d));

  for (const line of lines) {
    for (const pd of productDiscounts) {
      const appliesToProduct = pd.products?.some((p) => p.productId === line.productId);
      if (!appliesToProduct) continue;

      if (pd.minQuantity && line.quantity < pd.minQuantity) continue;
      if (pd.minPurchaseAmount && line.amount.lessThan(pd.minPurchaseAmount)) continue;

      let discountAmount: Prisma.Decimal;
      if (pd.type === "FIXED") {
        // Fixed amount discount cannot exceed the line total
        discountAmount = Prisma.Decimal.min(pd.value, line.amount);
      } else {
        // Percentage discount
        discountAmount = line.amount.mul(pd.value).div(100);
      }

      results.push({
        discount: pd,
        discountAmount,
        lineId: line.id,
        productId: line.productId,
        scope: "PRODUCT",
      });
    }
  }

  // 2. SUBSCRIPTION-SCOPED DISCOUNTS (Attached to subscription)
  if (subscription.discounts) {
    const totalLinesAmount = lines.reduce((acc, l) => acc.add(l.amount), new Prisma.Decimal(0));
    const totalLinesQuantity = lines.reduce((acc, l) => acc + l.quantity, 0);

    for (const sd of subscription.discounts) {
      const d = sd.discount ?? availableDiscounts.find((x) => x.id === sd.discountId);
      if (!d || !isValid(d) || d.scope !== "SUBSCRIPTION") continue;

      if (d.minQuantity && totalLinesQuantity < d.minQuantity) continue;
      if (d.minPurchaseAmount && totalLinesAmount.lessThan(d.minPurchaseAmount)) continue;

      let discountAmount: Prisma.Decimal;
      if (d.type === "FIXED") {
        discountAmount = Prisma.Decimal.min(d.value, totalLinesAmount);
      } else {
        discountAmount = totalLinesAmount.mul(d.value).div(100);
      }

      results.push({
        discount: d,
        discountAmount,
        scope: "SUBSCRIPTION",
      });
    }
  }

  return results;
}
