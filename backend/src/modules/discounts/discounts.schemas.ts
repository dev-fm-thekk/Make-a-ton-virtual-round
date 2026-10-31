import { z } from "zod";
import { dateOnly } from "../../lib/dates.js";
import { ANY_FIELD_MESSAGE, boundedInt, hasAnyField, moneyInput, positiveMoneyInput, queryBool, uuid } from "../../lib/schemas.js";
import { paginationQuery } from "../../lib/shared.js";

const type = z.enum(["FIXED", "PERCENTAGE"]);
const scope = z.enum(["PRODUCT", "SUBSCRIPTION"]);
const name = z.string().trim().min(1).max(120);
const usageLimit = boundedInt(1, 1_000_000_000);

// ==================== DISCOUNTS ====================

export const createDiscountSchema = z
  .object({
    name,
    type,
    /** An amount (FIXED) or a percentage 0-100 (PERCENTAGE). Always > 0. */
    value: positiveMoneyInput,
    scope,
    /** Only applies when the targeted lines add up to at least this (before this discount). */
    minPurchaseAmount: moneyInput.nullable().optional(),
    minQuantity: boundedInt(1, 1_000_000).nullable().optional(),
    startDate: dateOnly,
    endDate: dateOnly.nullable().optional(),
    /** How many INVOICES may use it in total. null/omitted = unlimited. */
    usageLimit: usageLimit.nullable().optional(),
    isActive: z.boolean().default(true),
    /** PRODUCT scope: the products it applies to. SUBSCRIPTION scope: leave empty (attach to subscriptions afterwards). */
    productIds: z.array(uuid).max(500).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.type === "PERCENTAGE" && Number(v.value) > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage can't be more than 100" });
    if (v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "endDate cannot be before startDate" });
    if (v.scope === "SUBSCRIPTION" && v.productIds.length) ctx.addIssue({ code: "custom", path: ["productIds"], message: "productIds only apply to PRODUCT-scoped discounts" });
    if (v.scope === "PRODUCT" && v.isActive && v.productIds.length === 0) ctx.addIssue({ code: "custom", path: ["productIds"], message: "An active product discount needs at least one product" });
  });

// Cross-field rules that depend on the stored row (type/value/dates/usage/products) are checked in the service.
export const updateDiscountSchema = z
  .object({
    name,
    type,
    value: positiveMoneyInput,
    scope,
    minPurchaseAmount: moneyInput.nullable(),
    minQuantity: boundedInt(1, 1_000_000).nullable(),
    startDate: dateOnly,
    endDate: dateOnly.nullable(),
    usageLimit: usageLimit.nullable(),
    isActive: z.boolean(),
    /** Replaces the whole product list when present. */
    productIds: z.array(uuid).max(500),
  })
  .partial()
  .refine(hasAnyField, ANY_FIELD_MESSAGE);

export const listDiscountsQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  scope: scope.optional(),
  type: type.optional(),
  isActive: queryBool,
  /** Filter by what is happening to it today. */
  status: z.enum(["inactive", "scheduled", "active", "expired", "exhausted"]).optional(),
});

// ==================== ATTACHMENTS ====================

export const attachDiscountProductsSchema = z.object({ productIds: z.array(uuid).min(1).max(500) });
export const attachSubscriptionDiscountSchema = z.object({ subscriptionId: uuid });

export type CreateDiscountInput = z.output<typeof createDiscountSchema>;
export type UpdateDiscountInput = z.output<typeof updateDiscountSchema>;
export type ListDiscountsQuery = z.output<typeof listDiscountsQuery>;
