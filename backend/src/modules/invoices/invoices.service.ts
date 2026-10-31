import type { Request } from "express";
import { env } from "../../config/env.js";
import type { InvoiceStatus, Prisma } from "../../generated/prisma/client.js";
import { audit } from "../../lib/audit.js";
import { diffDays, toDateOnly, todayUtc } from "../../lib/dates.js";
import { AppError, domainError, forbidden, notFound } from "../../lib/errors.js";
import { sendMail } from "../../lib/mailer.js";
import { money } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";
import { pageArgs, pageResult } from "../../lib/shared.js";
import { auth, type AuthContext } from "../../middleware/auth.js";
import { createInvoiceForPeriod, loadProductRules } from "../billing/engine.js";
import { lockSubscriptionForBilling } from "../subscriptions/subscriptions.billing.js";
import { paymentState } from "./derive.js";
import { renderInvoiceEmail } from "./invoices.mail.js";
import type { ListInvoicesQuery } from "./invoices.schemas.js";
import { renderInvoiceHtml, type PrintableInvoice } from "./invoices.print.js";
import { cancelInvoice, confirmDraft } from "./lifecycle.js";

export type InvoiceAction = "confirm" | "cancel" | "send" | "record_payment" | "reissue";

// ───────── scoping ─────────

/** Customers see only their own invoices, and never drafts or cancelled ones. Applied in the QUERY. */
function scope(actor: AuthContext): Prisma.InvoiceWhereInput {
  if (actor.role !== "CUSTOMER") return {};
  return { customerId: actor.customerId ?? "00000000-0000-0000-0000-000000000000", status: { in: ["CONFIRMED", "PAID"] } };
}

function actionsFor(status: InvoiceStatus, amountPaid: Prisma.Decimal, role: AuthContext["role"]): InvoiceAction[] {
  if (role === "CUSTOMER") return [];
  switch (status) {
    case "DRAFT":
      return ["confirm", "cancel"];
    case "CONFIRMED":
      return amountPaid.greaterThan(0) ? ["send", "record_payment"] : ["send", "record_payment", "cancel"];
    case "PAID":
      return ["send"];
    case "CANCELLED":
      return role === "ADMIN" ? ["reissue"] : [];
  }
}

// ───────── read models ─────────

const detailInclude = {
  customer: { select: { id: true, name: true, companyName: true } },
  subscription: { select: { id: true, number: true, paymentTerm: { select: { name: true } } } },
  lines: { orderBy: { sortOrder: "asc" }, include: { product: { select: { name: true } } } },
  payments: { orderBy: { paidAt: "asc" }, select: { id: true, method: true, amount: true, paidAt: true, reference: true, note: true } },
} satisfies Prisma.InvoiceInclude;

type Detail = Prisma.InvoiceGetPayload<{ include: typeof detailInclude }>;

async function loadDetail(id: string, actor: AuthContext): Promise<Detail> {
  const inv = await prisma.invoice.findFirst({ where: { id, ...scope(actor) }, include: detailInclude });
  if (!inv) throw notFound("Invoice"); // 404, never 403: don't reveal other customers' ids
  return inv;
}

async function detailDto(inv: Detail, actor: AuthContext) {
  const today = todayUtc();
  const staff = actor.role !== "CUSTOMER";
  const redemptions = await prisma.discountRedemption.findMany({ where: { invoiceId: inv.id }, select: { amount: true, discount: { select: { id: true, name: true, type: true, value: true } } } });
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    paymentState: paymentState(inv.status, inv.dueDate, today),
    customer: inv.customer,
    subscription: { id: inv.subscription.id, number: inv.subscription.number },
    paymentTerm: inv.subscription.paymentTerm.name,
    billTo: { name: inv.billToName, email: inv.billToEmail, address: inv.billToAddress, taxId: inv.billToTaxId },
    periodStart: toDateOnly(inv.periodStart),
    periodEnd: toDateOnly(inv.periodEnd),
    issueDate: toDateOnly(inv.issueDate),
    dueDate: toDateOnly(inv.dueDate),
    daysOverdue: inv.status === "CONFIRMED" && inv.dueDate < today ? diffDays(today, inv.dueDate) : 0,
    currency: inv.currency,
    subtotal: money(inv.subtotal),
    discountTotal: money(inv.discountTotal),
    taxTotal: money(inv.taxTotal),
    total: money(inv.total),
    amountPaid: money(inv.amountPaid),
    balance: money(inv.status === "CANCELLED" ? 0 : inv.total.minus(inv.amountPaid)),
    lines: inv.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: money(l.unitPrice),
      discountAmount: money(l.discountAmount),
      taxRatePercent: money(l.taxRatePercent),
      taxAmount: money(l.taxAmount),
      lineTotal: money(l.lineTotal),
    })),
    discounts: redemptions.map((r) => ({ id: r.discount.id, name: r.discount.name, amount: money(r.amount) })),
    payments: inv.payments.map((p) => ({ id: p.id, method: p.method, amount: money(p.amount), paidAt: p.paidAt, reference: p.reference, note: staff ? p.note : null })),
    sentAt: inv.sentAt,
    confirmedAt: inv.confirmedAt,
    paidAt: inv.paidAt,
    cancelledAt: inv.cancelledAt,
    ...(staff ? { notes: inv.notes, billingRunId: inv.billingRunId } : {}),
    availableActions: actionsFor(inv.status, inv.amountPaid, actor.role),
    createdAt: inv.createdAt,
  };
}

export async function getInvoice(req: Request, id: string) {
  const actor = auth(req);
  return detailDto(await loadDetail(id, actor), actor);
}

export async function listInvoices(req: Request, q: ListInvoicesQuery) {
  const actor = auth(req);
  const today = todayUtc();
  const staff = actor.role !== "CUSTOMER";

  const where: Prisma.InvoiceWhereInput = {
    ...scope(actor),
    // a customer's own scope already restricts status; otherwise honour the filter
    ...(q.status && (staff || !scope(actor).status) && { status: { in: q.status } }),
    ...(staff && q.customerId && { customerId: q.customerId }),
    ...(q.subscriptionId && { subscriptionId: q.subscriptionId }),
    ...(staff && q.billingRunId && { billingRunId: q.billingRunId }),
    ...((q.from || q.to) && { issueDate: { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) } }),
    ...(q.overdue === true && { status: "CONFIRMED", dueDate: { lt: today } }),
    ...(q.search && { OR: [{ number: { contains: q.search, mode: "insensitive" } }, ...(staff ? [{ billToName: { contains: q.search, mode: "insensitive" as const } }] : [])] }),
  };
  const dir = q.sort.startsWith("-") ? "desc" : "asc";
  const field = q.sort.replace(/^-/, "") as "issueDate" | "dueDate" | "total" | "createdAt";

  const [rows, count, totals] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: [{ [field]: dir }, { id: "asc" }],
      select: {
        id: true,
        number: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        issueDate: true,
        dueDate: true,
        total: true,
        amountPaid: true,
        sentAt: true,
        customer: { select: { id: true, name: true, companyName: true } },
        subscription: { select: { id: true, number: true } },
      },
      ...pageArgs(q),
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where, _sum: { total: true, amountPaid: true } }),
  ]);

  const sumTotal = totals._sum.total ?? 0;
  const sumPaid = totals._sum.amountPaid ?? 0;
  return {
    totals: { invoices: count, total: money(sumTotal), paid: money(sumPaid), balance: money(Number(sumTotal) - Number(sumPaid)) },
    ...pageResult(
      rows.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        paymentState: paymentState(r.status, r.dueDate, today),
        customer: r.customer,
        subscription: r.subscription,
        periodStart: toDateOnly(r.periodStart),
        periodEnd: toDateOnly(r.periodEnd),
        issueDate: toDateOnly(r.issueDate),
        dueDate: toDateOnly(r.dueDate),
        total: money(r.total),
        amountPaid: money(r.amountPaid),
        balance: money(r.status === "CANCELLED" ? 0 : r.total.minus(r.amountPaid)),
        sentAt: r.sentAt,
      })),
      count,
      q,
    ),
  };
}

// ───────── lifecycle (staff) ─────────

export async function confirm(req: Request, id: string) {
  const actor = auth(req);
  const res = await prisma.$transaction(async (tx) => {
    const r = await confirmDraft(tx, id);
    await audit(req, { action: "invoice.confirm", entityType: "Invoice", entityId: id, metadata: { number: r.number } }, tx);
    return r;
  });
  return { invoice: await detailDto(await loadDetail(res.id, actor), actor) };
}

export async function cancel(req: Request, id: string, reason: string) {
  const actor = auth(req);
  await prisma.$transaction(async (tx) => {
    const before = await tx.invoice.findUnique({ where: { id }, select: { notes: true } });
    if (!before) throw notFound("Invoice");
    await cancelInvoice(tx, id);
    await tx.invoice.update({ where: { id }, data: { notes: [before.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n") } });
    await audit(req, { action: "invoice.cancel", entityType: "Invoice", entityId: id, metadata: { reason } }, tx);
  });
  return { invoice: await detailDto(await loadDetail(id, actor), actor) };
}

/**
 * Confirms many drafts. Each invoice is its own transaction, so one failure never blocks the rest.
 * Oldest first, so invoice numbers follow creation order.
 */
export async function bulkConfirm(req: Request, input: { ids?: string[]; billingRunId?: string }) {
  const rows = await prisma.invoice.findMany({
    where: { status: "DRAFT", ...(input.ids ? { id: { in: input.ids } } : { billingRunId: input.billingRunId }) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
    take: 500,
  });
  const failed: { id: string; error: string }[] = [];
  let confirmed = 0;
  for (const { id } of rows) {
    try {
      await prisma.$transaction(async (tx) => {
        await confirmDraft(tx, id);
      });
      confirmed++;
    } catch (err) {
      failed.push({ id, error: err instanceof AppError ? err.message : "unexpected error" });
    }
  }
  await audit(req, { action: "invoice.bulk_confirm", entityType: "Invoice", metadata: { confirmed, failed: failed.length, billingRunId: input.billingRunId } });
  return { requested: input.ids?.length ?? rows.length, confirmed, failed, more: rows.length === 500 };
}

/**
 * Recreate the invoice for a CANCELLED invoice's period (e.g. it was cancelled by mistake or the lines were wrong).
 * Uses the subscription's CURRENT lines, prices and discounts. Refused if that period has a live invoice.
 */
export async function reissue(req: Request, id: string) {
  const actor = auth(req);
  const newId = await prisma.$transaction(
    async (tx) => {
      const old = await tx.invoice.findUnique({ where: { id }, select: { status: true, subscriptionId: true, periodStart: true, periodEnd: true } });
      if (!old) throw notFound("Invoice");
      if (old.status !== "CANCELLED") throw domainError("INVALID_TRANSITION", "Only cancelled invoices can be reissued", { status: old.status });

      const sub = await lockSubscriptionForBilling(tx, old.subscriptionId);
      if (!sub) throw notFound("Subscription");
      const live = await tx.invoice.findFirst({ where: { subscriptionId: old.subscriptionId, periodStart: old.periodStart, status: { not: "CANCELLED" } }, select: { number: true } });
      if (live) throw domainError("PERIOD_ALREADY_INVOICED", "That billing period already has a live invoice", { number: live.number });

      const today = todayUtc();
      const created = await createInvoiceForPeriod(tx, sub, { periodStart: old.periodStart, periodEnd: old.periodEnd }, {
        issueDate: today,
        billingRunId: null,
        productRules: await loadProductRules(tx, today),
        exhausted: new Set(),
        autoConfirm: false,
      });
      await audit(req, { action: "invoice.reissue", entityType: "Invoice", entityId: created.id, metadata: { replaces: id } }, tx);
      return created.id;
    },
    { timeout: 30_000 },
  );
  return { invoice: await detailDto(await loadDetail(newId, actor), actor) };
}

// ───────── delivery ─────────

function toPrintable(d: Awaited<ReturnType<typeof detailDto>>): PrintableInvoice {
  return {
    number: d.number,
    status: d.status,
    currency: d.currency,
    issueDate: d.issueDate,
    dueDate: d.dueDate,
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    billTo: { name: d.billTo.name, email: d.billTo.email, taxId: d.billTo.taxId, address: (d.billTo.address as Record<string, string> | null) ?? null },
    subscriptionNumber: d.subscription.number,
    paymentTermName: d.paymentTerm,
    lines: d.lines,
    subtotal: d.subtotal,
    discountTotal: d.discountTotal,
    taxTotal: d.taxTotal,
    total: d.total,
    amountPaid: d.amountPaid,
    balance: d.balance,
    notes: "notes" in d ? (d.notes ?? null) : null,
  };
}

/** A self-contained HTML page the browser can print or save as PDF. */
export async function printHtml(req: Request, id: string): Promise<string> {
  const actor = auth(req);
  return renderInvoiceHtml(toPrintable(await detailDto(await loadDetail(id, actor), actor)));
}

/** Email the invoice to the customer's address on the invoice. Only issued invoices can be sent. */
export async function send(req: Request, id: string) {
  const actor = auth(req);
  if (actor.role === "CUSTOMER") throw forbidden();
  const d = await detailDto(await loadDetail(id, actor), actor);
  if (d.status === "DRAFT") throw domainError("NOT_CONFIRMED", "Confirm the invoice before sending it");
  if (d.status === "CANCELLED") throw domainError("INVALID_TRANSITION", "A cancelled invoice can't be sent");

  const mail = renderInvoiceEmail({
    number: d.number!,
    customerName: d.billTo.name,
    total: d.total,
    balance: d.balance,
    currency: d.currency,
    dueDate: d.dueDate,
    status: d.status,
    link: `${env.APP_BASE_URL}/my/invoices/${d.id}`,
  });
  try {
    await sendMail({ to: d.billTo.email, ...mail });
  } catch {
    throw new AppError(502, "MAIL_FAILED", "The email could not be delivered right now. Try again shortly.");
  }
  await prisma.invoice.update({ where: { id }, data: { sentAt: new Date() } });
  await audit(req, { action: "invoice.send", entityType: "Invoice", entityId: id, metadata: { to: d.billTo.email } });
  return { invoice: await detailDto(await loadDetail(id, actor), actor) };
}

