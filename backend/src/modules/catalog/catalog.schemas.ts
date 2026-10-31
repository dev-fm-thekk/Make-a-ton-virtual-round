import { z } from "zod";
import { paginationQuery } from "../../lib/shared.js";

/** Regex to validate numeric/decimal strings with up to 2 decimal places */
export const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid decimal string (e.g. '10.50')");
export const percentageString = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "Must be a valid percentage (e.g. '18.00')");

// ==================== TAX SCHEMAS ====================

export const createTaxSchema = z.object({
  name: z.string().trim().min(1).max(100),
  ratePercent: percentageString,
  isActive: z.boolean().optional().default(true),
});

export const updateTaxSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  ratePercent: percentageString.optional(),
  isActive: z.boolean().optional(),
});

export const listTaxesQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  isActive: z.preprocess((val) => (val === "true" ? true : val === "false" ? false : val), z.boolean().optional()),
});

// ==================== PRODUCT SCHEMAS ====================

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(["SERVICE", "GOODS"]),
  salesPrice: decimalString,
  costPrice: decimalString,
  notes: z.string().trim().max(1000).optional(),
  taxId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  type: z.enum(["SERVICE", "GOODS"]).optional(),
  salesPrice: decimalString.optional(),
  costPrice: decimalString.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  taxId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const listProductsQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  type: z.enum(["SERVICE", "GOODS"]).optional(),
  isActive: z.preprocess((val) => (val === "true" ? true : val === "false" ? false : val), z.boolean().optional()),
});

// ==================== PRODUCT VARIANT SCHEMAS ====================

export const createVariantSchema = z.object({
  attribute: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(100),
  extraPrice: decimalString.optional().default("0.00"),
  isActive: z.boolean().optional().default(true),
});

export const updateVariantSchema = z.object({
  attribute: z.string().trim().min(1).max(100).optional(),
  value: z.string().trim().min(1).max(100).optional(),
  extraPrice: decimalString.optional(),
  isActive: z.boolean().optional(),
});

// ==================== PAYMENT TERM SCHEMAS ====================

export const createPaymentTermSchema = z.object({
  name: z.string().trim().min(1).max(100),
  dueDays: z.coerce.number().int().min(0).max(365),
  isDefault: z.boolean().optional().default(false),
});

export const updatePaymentTermSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  dueDays: z.coerce.number().int().min(0).max(365).optional(),
  isDefault: z.boolean().optional(),
});

export const listPaymentTermsQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
});
