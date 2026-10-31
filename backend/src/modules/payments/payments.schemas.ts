import { z } from "zod";
import { moneyInput } from "../subscriptions/subscriptions.schemas.js";

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "UPI", "CHEQUE", "OTHER"] as const;

/** An ISO timestamp ("2026-03-02T10:15:00Z") or a plain date ("2026-03-02", taken as that day at 00:00 UTC). */
const paidAt = z
  .union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
  .transform((s, ctx) => {
    const d = new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Not a valid date" });
      return z.NEVER;
    }
    return d;
  });

export const recordPaymentBody = z.object({
  method: z.enum(PAYMENT_METHODS),
  /** Positive, at most 2 decimals. Must not exceed what is still owed on the invoice. */
  amount: moneyInput.refine((v) => Number(v) > 0, "Amount must be greater than zero"),
  /** When the money arrived. Defaults to now; can't be in the future or before the invoice was issued. */
  paidAt: paidAt.optional(),
  /** Bank reference, cheque number, gateway transaction id… */
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});
export type RecordPaymentBody = z.output<typeof recordPaymentBody>;

/** Client-generated key (a UUID is ideal) that makes a retried POST safe. */
export const idempotencyKeyHeader = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_\-:.]+$/, "Use letters, digits and _ - : . only");
