import { z } from "zod";
import { dateOnly } from "../../lib/dates.js";
import { moneyInput } from "../../lib/schemas.js";
import { paginationQuery } from "../../lib/shared.js";

export { moneyInput }; // payments reuse it
const uuid = z.string().uuid();

export const lineInputSchema = z.object({
  productId: uuid,
  variantId: uuid.nullish(),
  quantity: z.number().int().min(1).max(1_000_000),
  /** Omit to use the catalog price (product sales price + variant extra). */
  unitPrice: moneyInput.optional(),
  /** Omit to use the product's default tax; `null` = no tax on this line. */
  taxId: uuid.nullish(),
  description: z.string().trim().max(300).optional(),
});
export type LineInput = z.infer<typeof lineInputSchema>;

const linesArray = z.array(lineInputSchema).max(100);
const version = z.number().int().min(1);

export const createSubscriptionSchema = z
  .object({
    customerId: uuid,
    /** Required unless a template (which carries its own plan) is used. */
    planId: uuid.optional(),
    /** Start from a quotation template: copies its plan + lines and sets the quote validity window. */
    quotationTemplateId: uuid.optional(),
    /** Defaults to the payment term flagged as default. */
    paymentTermId: uuid.optional(),
    startDate: dateOnly,
    expiryDate: dateOnly.optional(),
    notes: z.string().trim().max(2000).optional(),
    /** When given alongside a template, these REPLACE the template's lines. */
    lines: linesArray.optional(),
  })
  .refine((v) => v.planId || v.quotationTemplateId, { message: "Provide planId or quotationTemplateId", path: ["planId"] })
  .refine((v) => !v.expiryDate || v.expiryDate >= v.startDate, { message: "Expiry date must be on or after the start date", path: ["expiryDate"] });

export const updateSubscriptionSchema = z
  .object({
    version,
    planId: uuid,
    paymentTermId: uuid,
    startDate: dateOnly,
    expiryDate: dateOnly.nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .partial({ planId: true, paymentTermId: true, startDate: true, expiryDate: true, notes: true })
  .refine((v) => Object.keys(v).length > 1, "Provide at least one field to update");

export const replaceLinesSchema = z.object({ version, lines: linesArray.min(1, "A subscription needs at least one line") });

export const transitionSchema = z.object({
  action: z.enum(["send_quotation", "confirm", "activate", "pause", "resume", "close", "renew"]),
  version,
  reason: z.string().trim().min(1).max(500).optional(),
  /** Required for `renew`: the new (later) expiry date. */
  expiryDate: dateOnly.optional(),
});

const statusList = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))
  .pipe(z.array(z.enum(["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "PAUSED", "CLOSED"])).max(6));

export const listSubscriptionsQuery = paginationQuery.extend({
  /** Comma-separated, e.g. ?status=ACTIVE,PAUSED */
  status: statusList.optional(),
  customerId: uuid.optional(), // ignored for CUSTOMER role (always scoped to themselves)
  planId: uuid.optional(),
  search: z.string().trim().max(100).optional(),
  startFrom: dateOnly.optional(),
  startTo: dateOnly.optional(),
  sort: z.enum(["createdAt", "-createdAt", "startDate", "-startDate", "number", "-number", "nextBillingDate", "-nextBillingDate"]).default("-createdAt"),
});
export type ListSubscriptionsQuery = z.infer<typeof listSubscriptionsQuery>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
export type TransitionInput = z.infer<typeof transitionSchema>;
