import { z } from "zod";
import { paginationQuery } from "../../lib/shared.js";

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const billingAddressSchema = z
  .object({
    line1: trimmed(200).min(1),
    line2: trimmed(200).optional(),
    city: trimmed(100).min(1),
    state: trimmed(100).optional(),
    postalCode: trimmed(20).min(1),
    country: trimmed(100).min(1),
  })
  .strict();

const email = z.string().trim().toLowerCase().email().max(254);

export const createCustomerSchema = z.object({
  name: trimmed(120).min(1),
  companyName: optionalText(160),
  email,
  phone: optionalText(40),
  taxId: optionalText(40),
  billingAddress: billingAddressSchema.optional(),
  notes: optionalText(2000),
});

/** PATCH: every field optional; null clears an optional field. */
export const updateCustomerSchema = z
  .object({
    name: trimmed(120).min(1),
    companyName: trimmed(160).nullable(),
    email,
    phone: trimmed(40).nullable(),
    taxId: trimmed(40).nullable(),
    billingAddress: billingAddressSchema.nullable(),
    notes: trimmed(2000).nullable(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Provide at least one field to update");

/** What a customer may edit about themselves. Notes (internal) and login email are not editable here. */
export const updateOwnProfileSchema = z
  .object({
    name: trimmed(120).min(1),
    companyName: trimmed(160).nullable(),
    phone: trimmed(40).nullable(),
    taxId: trimmed(40).nullable(),
    billingAddress: billingAddressSchema.nullable(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "Provide at least one field to update");

export const listCustomersQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  hasPortalAccess: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  sort: z.enum(["name", "-name", "createdAt", "-createdAt"]).default("-createdAt"),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuery>;
