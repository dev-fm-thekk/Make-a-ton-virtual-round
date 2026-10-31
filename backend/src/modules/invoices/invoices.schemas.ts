import { z } from "zod";
import { dateOnly } from "../../lib/dates.js";
import { paginationQuery } from "../../lib/shared.js";

const uuid = z.string().uuid();

const statusList = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))
  .pipe(z.array(z.enum(["DRAFT", "CONFIRMED", "PAID", "CANCELLED"])).min(1).max(4));

export const listInvoicesQuery = paginationQuery
  .extend({
    /** Comma-separated, e.g. ?status=DRAFT,CONFIRMED */
    status: statusList.optional(),
    customerId: uuid.optional(), // ignored for CUSTOMER role (always their own)
    subscriptionId: uuid.optional(),
    /** Review the drafts a billing run produced. */
    billingRunId: uuid.optional(),
    search: z.string().trim().max(100).optional(),
    /** Issue-date range (inclusive). */
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    /** Only invoices past their due date and not fully paid. */
    overdue: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    sort: z.enum(["-issueDate", "issueDate", "-dueDate", "dueDate", "-total", "-createdAt"]).default("-issueDate"),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "`from` must be on or before `to`", path: ["from"] });
export type ListInvoicesQuery = z.output<typeof listInvoicesQuery>;

export const cancelBody = z.object({ reason: z.string().trim().min(1, "A reason is required").max(500) });

export const bulkConfirmBody = z
  .object({
    ids: z.array(uuid).min(1).max(500).optional(),
    /** Confirm every draft that billing run produced (up to 500 per call; call again for more). */
    billingRunId: uuid.optional(),
  })
  .refine((v) => !!v.ids !== !!v.billingRunId, { message: "Provide either ids or billingRunId", path: ["ids"] });
