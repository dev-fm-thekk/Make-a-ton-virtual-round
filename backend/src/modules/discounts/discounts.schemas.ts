import { z } from "zod";
import { paginationQuery } from "../../lib/shared.js";

/** Regex to validate numeric/decimal strings with up to 2 decimal places */
export const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid decimal string (e.g. '10.00')");

// ==================== DISCOUNT SCHEMAS ====================

export const createDiscountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["FIXED", "PERCENTAGE"]),
  value: decimalString,
  scope: z.enum(["PRODUCT", "SUBSCRIPTION"]),
  minPurchaseAmount: decimalString.nullable().optional(),
  minQuantity: z.coerce.number().int().min(1).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date string (YYYY-MM-DD)"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date string (YYYY-MM-DD)").nullable().optional(),
  usageLimit: z.coerce.number().int().min(1).nullable().optional(),
  isActive: z.boolean().optional().default(true),
  productIds: z.array(z.string().uuid()).optional().default([]), // for PRODUCT-scoped discounts
});

export const updateDiscountSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: z.enum(["FIXED", "PERCENTAGE"]).optional(),
  value: decimalString.optional(),
  scope: z.enum(["PRODUCT", "SUBSCRIPTION"]).optional(),
  minPurchaseAmount: decimalString.nullable().optional(),
  minQuantity: z.coerce.number().int().min(1).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date string (YYYY-MM-DD)").optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date string (YYYY-MM-DD)").nullable().optional(),
  usageLimit: z.coerce.number().int().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  productIds: z.array(z.string().uuid()).optional(),
});

export const listDiscountsQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  scope: z.enum(["PRODUCT", "SUBSCRIPTION"]).optional(),
  type: z.enum(["FIXED", "PERCENTAGE"]).optional(),
  isActive: z.preprocess((val) => (val === "true" ? true : val === "false" ? false : val), z.boolean().optional()),
});

// ==================== ATTACHMENT SCHEMAS ====================

export const attachDiscountProductsSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1),
});

export const attachSubscriptionDiscountSchema = z.object({
  subscriptionId: z.string().uuid(),
});
