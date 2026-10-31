import { z } from "zod";
import { addDays, dateOnly, diffDays, todayUtc } from "../../lib/dates.js";
import { paginationQuery } from "../../lib/shared.js";

const MAX_RANGE_DAYS = 366 * 5;
const uuid = z.string().uuid();

/** Optional `from`/`to` (inclusive, YYYY-MM-DD). Defaults to the current month so far. */
const range = z.object({ from: dateOnly.optional(), to: dateOnly.optional() });

function withDefaultRange<T extends { from?: Date; to?: Date }>(v: T, ctx: z.RefinementCtx) {
  const today = todayUtc();
  const to = v.to ?? today;
  const from = v.from ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  if (from > to) {
    ctx.addIssue({ code: "custom", path: ["from"], message: "`from` must be on or before `to`" });
    return z.NEVER;
  }
  if (diffDays(to, from) > MAX_RANGE_DAYS) {
    ctx.addIssue({ code: "custom", path: ["from"], message: "Date range is too large (max 5 years)" });
    return z.NEVER;
  }
  return { ...v, from, to };
}

export const summaryQuery = range.transform(withDefaultRange);

export const revenueQuery = range
  .extend({ groupBy: z.enum(["day", "week", "month"]).default("month") })
  .transform(withDefaultRange)
  .superRefine((v, ctx) => {
    const days = diffDays(v.to, v.from) + 1;
    const buckets = v.groupBy === "day" ? days : v.groupBy === "week" ? Math.ceil(days / 7) + 1 : Math.ceil(days / 28) + 1;
    if (buckets > 400) ctx.addIssue({ code: "custom", path: ["groupBy"], message: `Too many buckets (${buckets}); use a coarser groupBy or a shorter range` });
  });

const asOf = dateOnly.optional();

export const overdueQuery = paginationQuery.extend({
  asOf,
  customerId: uuid.optional(),
  minDaysOverdue: z.coerce.number().int().min(1).max(3650).optional(),
  sort: z.enum(["dueDate", "-dueDate", "-balance"]).default("dueDate"),
});

export const invoicesQuery = paginationQuery
  .extend({
    state: z.enum(["all", "paid", "outstanding", "overdue"]).default("all"),
    asOf,
    from: dateOnly.optional(), // issue date range
    to: dateOnly.optional(),
    customerId: uuid.optional(),
    subscriptionId: uuid.optional(),
    search: z.string().trim().max(100).optional(),
    sort: z.enum(["-issueDate", "issueDate", "dueDate", "-dueDate", "-total"]).default("-issueDate"),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "`from` must be on or before `to`", path: ["from"] });

export const paymentsQuery = paginationQuery
  .extend({
    from: dateOnly.optional(), // payment date range (inclusive)
    to: dateOnly.optional(),
    method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "UPI", "CHEQUE", "OTHER"]).optional(),
    customerId: uuid.optional(),
    search: z.string().trim().max(100).optional(),
    sort: z.enum(["-paidAt", "paidAt", "-amount"]).default("-paidAt"),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "`from` must be on or before `to`", path: ["from"] });

export const subscriptionsReportQuery = paginationQuery.extend({
  status: z
    .string()
    .transform((s) => s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))
    .pipe(z.array(z.enum(["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "PAUSED", "CLOSED"])).max(6))
    .optional(),
  planId: uuid.optional(),
  customerId: uuid.optional(),
  startFrom: dateOnly.optional(),
  startTo: dateOnly.optional(),
  sort: z.enum(["-mrr", "mrr", "-startDate", "startDate"]).default("-mrr"),
});

export type SummaryQuery = z.output<typeof summaryQuery>;
export type RevenueQuery = z.output<typeof revenueQuery>;
export type OverdueQuery = z.output<typeof overdueQuery>;
export type InvoicesQuery = z.output<typeof invoicesQuery>;
export type PaymentsQuery = z.output<typeof paymentsQuery>;
export type SubscriptionsReportQuery = z.output<typeof subscriptionsReportQuery>;

export const endOfDay = (d: Date) => addDays(d, 1); // exclusive upper bound for timestamp comparisons
