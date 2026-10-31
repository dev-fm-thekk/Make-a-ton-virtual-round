import { z } from "zod";
import { paginationQuery } from "../../lib/shared.js";
import { ANY_FIELD_MESSAGE, boundedInt, hasAnyField, moneyInput, percentInput, queryBool, uuid } from "../../lib/schemas.js";

const name = (max: number) => z.string().trim().min(1).max(max);

// ==================== TAXES ====================

export const createTaxSchema = z.object({
  name: name(100),
  ratePercent: percentInput,
  isActive: z.boolean().default(true),
});

export const updateTaxSchema = z
  .object({ name: name(100), ratePercent: percentInput, isActive: z.boolean() })
  .partial()
  .refine(hasAnyField, ANY_FIELD_MESSAGE);

export const listTaxesQuery = paginationQuery.extend({ search: z.string().trim().max(100).optional(), isActive: queryBool });

// ==================== PRODUCTS ====================

export const createProductSchema = z.object({
  name: name(200),
  type: z.enum(["SERVICE", "GOODS"]),
  salesPrice: moneyInput,
  costPrice: moneyInput,
  notes: z.string().trim().max(1000).optional(),
  taxId: uuid.nullable().optional(),
  isActive: z.boolean().default(true),
});

export const updateProductSchema = z
  .object({
    name: name(200),
    type: z.enum(["SERVICE", "GOODS"]),
    salesPrice: moneyInput,
    costPrice: moneyInput,
    notes: z.string().trim().max(1000).nullable(),
    taxId: uuid.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine(hasAnyField, ANY_FIELD_MESSAGE);

export const listProductsQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  type: z.enum(["SERVICE", "GOODS"]).optional(),
  isActive: queryBool,
});

// ==================== PRODUCT VARIANTS ====================

export const createVariantSchema = z.object({
  attribute: name(100),
  value: name(100),
  extraPrice: moneyInput.default("0.00"),
  isActive: z.boolean().default(true),
});

export const updateVariantSchema = z
  .object({ attribute: name(100), value: name(100), extraPrice: moneyInput, isActive: z.boolean() })
  .partial()
  .refine(hasAnyField, ANY_FIELD_MESSAGE);

// ==================== PAYMENT TERMS ====================

export const createPaymentTermSchema = z.object({
  name: name(100),
  dueDays: boundedInt(0, 365),
  isDefault: z.boolean().default(false),
});

export const updatePaymentTermSchema = z
  .object({ name: name(100), dueDays: boundedInt(0, 365), isDefault: z.boolean() })
  .partial()
  .refine(hasAnyField, ANY_FIELD_MESSAGE);

export const listPaymentTermsQuery = paginationQuery.extend({ search: z.string().trim().max(100).optional() });

export type CreateTaxInput = z.output<typeof createTaxSchema>;
export type UpdateTaxInput = z.output<typeof updateTaxSchema>;
export type CreateProductInput = z.output<typeof createProductSchema>;
export type UpdateProductInput = z.output<typeof updateProductSchema>;
export type CreateVariantInput = z.output<typeof createVariantSchema>;
export type UpdateVariantInput = z.output<typeof updateVariantSchema>;
export type CreatePaymentTermInput = z.output<typeof createPaymentTermSchema>;
export type UpdatePaymentTermInput = z.output<typeof updatePaymentTermSchema>;
