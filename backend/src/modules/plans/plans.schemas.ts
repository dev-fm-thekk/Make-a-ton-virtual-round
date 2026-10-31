import { z } from "zod";
import { dateOnly } from "../../lib/dates.js";
import { ANY_FIELD_MESSAGE, boundedInt, hasAnyField, moneyInput, queryBool, uuid } from "../../lib/schemas.js";
import { paginationQuery } from "../../lib/shared.js";

const period = z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
const name = z.string().trim().min(1).max(120);
const dateRange = (v: { availableFrom?: Date; availableUntil?: Date | null }) => !v.availableFrom || !v.availableUntil || v.availableUntil >= v.availableFrom;
const RANGE_ERROR = { message: "availableUntil cannot be before availableFrom", path: ["availableUntil"] };

// ==================== PLANS ====================

export const createPlanSchema = z
  .object({
    name,
    price: moneyInput,
    billingPeriod: period,
    /** Bill every N periods: 1 = every month, 3 = quarterly (MONTHLY). */
    billingInterval: boundedInt(1, 365).default(1),
    minQuantity: boundedInt(1, 1_000_000).default(1),
    availableFrom: dateOnly,
    availableUntil: dateOnly.nullable().optional(),
    autoCloseOnEnd: z.boolean().default(false),
    allowEarlyClose: z.boolean().default(false),
    allowPause: z.boolean().default(false),
    allowRenewal: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .refine(dateRange, RANGE_ERROR);

export const updatePlanSchema = z
  .object({
    name,
    price: moneyInput,
    billingPeriod: period,
    billingInterval: boundedInt(1, 365),
    minQuantity: boundedInt(1, 1_000_000),
    availableFrom: dateOnly,
    availableUntil: dateOnly.nullable(),
    autoCloseOnEnd: z.boolean(),
    allowEarlyClose: z.boolean(),
    allowPause: z.boolean(),
    allowRenewal: z.boolean(),
    isActive: z.boolean(),
  })
  .partial()
  .refine(hasAnyField, ANY_FIELD_MESSAGE)
  .refine(dateRange, RANGE_ERROR);

export const listPlansQuery = paginationQuery.extend({ search: z.string().trim().max(100).optional(), billingPeriod: period.optional(), isActive: queryBool });

// ==================== QUOTATION TEMPLATES ====================

/** Line order is the order of the array: there is no separate sortOrder to get wrong. */
export const quotationTemplateLine = z.object({
  productId: uuid,
  variantId: uuid.nullable().optional(),
  quantity: boundedInt(1, 1_000_000).default(1),
});

export const createQuotationTemplateSchema = z.object({
  name,
  planId: uuid,
  /** How long a quotation built from this template stays acceptable. */
  validityDays: boundedInt(1, 365).default(30),
  notes: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().default(true),
  lines: z.array(quotationTemplateLine).max(100).default([]),
});

export const updateQuotationTemplateSchema = z
  .object({
    name,
    planId: uuid,
    validityDays: boundedInt(1, 365),
    notes: z.string().trim().max(1000).nullable(),
    isActive: z.boolean(),
    /** Replaces ALL lines when present. */
    lines: z.array(quotationTemplateLine).max(100),
  })
  .partial()
  .refine(hasAnyField, ANY_FIELD_MESSAGE);

export const listQuotationTemplatesQuery = paginationQuery.extend({ search: z.string().trim().max(100).optional(), planId: uuid.optional(), isActive: queryBool });

export type CreatePlanInput = z.output<typeof createPlanSchema>;
export type UpdatePlanInput = z.output<typeof updatePlanSchema>;
export type QuotationLineInput = z.output<typeof quotationTemplateLine>;
export type CreateQuotationTemplateInput = z.output<typeof createQuotationTemplateSchema>;
export type UpdateQuotationTemplateInput = z.output<typeof updateQuotationTemplateSchema>;
