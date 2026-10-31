import { z } from "zod";
import { paginationQuery } from "../../lib/shared.js";

/** Regex to validate numeric/decimal strings with up to 2 decimal places */
export const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid decimal string (e.g. '99.00')");

// ==================== PLAN SCHEMAS ====================

export const createPlanSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: decimalString,
  billingPeriod: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  billingInterval: z.coerce.number().int().min(1).default(1),
  minQuantity: z.coerce.number().int().min(1).default(1),
  availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date string (YYYY-MM-DD)"),
  availableUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date string (YYYY-MM-DD)").nullable().optional(),
  autoCloseOnEnd: z.boolean().optional().default(false),
  allowEarlyClose: z.boolean().optional().default(false),
  allowPause: z.boolean().optional().default(false),
  allowRenewal: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
});

export const updatePlanSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  price: decimalString.optional(),
  billingPeriod: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).optional(),
  billingInterval: z.coerce.number().int().min(1).optional(),
  minQuantity: z.coerce.number().int().min(1).optional(),
  availableFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date string (YYYY-MM-DD)").optional(),
  availableUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date string (YYYY-MM-DD)").nullable().optional(),
  autoCloseOnEnd: z.boolean().optional(),
  allowEarlyClose: z.boolean().optional(),
  allowPause: z.boolean().optional(),
  allowRenewal: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const listPlansQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  billingPeriod: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).optional(),
  isActive: z.preprocess((val) => (val === "true" ? true : val === "false" ? false : val), z.boolean().optional()),
});

// ==================== QUOTATION TEMPLATE SCHEMAS ====================

export const quotationTemplateLineInput = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export const createQuotationTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  planId: z.string().uuid(),
  validityDays: z.coerce.number().int().min(1).max(365).default(30),
  notes: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().optional().default(true),
  lines: z.array(quotationTemplateLineInput).optional().default([]),
});

export const updateQuotationTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  planId: z.string().uuid().optional(),
  validityDays: z.coerce.number().int().min(1).max(365).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
  lines: z.array(quotationTemplateLineInput).optional(),
});

export const listQuotationTemplatesQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  planId: z.string().uuid().optional(),
  isActive: z.preprocess((val) => (val === "true" ? true : val === "false" ? false : val), z.boolean().optional()),
});
