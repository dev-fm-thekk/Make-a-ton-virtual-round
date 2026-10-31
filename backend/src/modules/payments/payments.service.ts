import type { Request } from "express";
import type { Prisma } from "../../generated/prisma/client.js";
import { audit } from "../../lib/audit.js";
import { toDateOnly } from "../../lib/dates.js";
import { badRequest, domainError, notFound } from "../../lib/errors.js";
import { sendMailBackground } from "../../lib/mailer.js";
import { D, money, round2 } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";
import { auth, type AuthContext } from "../../middleware/auth.js";
import { env } from "../../config/env.js";
import { escapeHtml } from "../invoices/invoices.print.js";
import { lockInvoice } from "../invoices/lifecycle.js";
import type { RecordPaymentBody } from "./payments.schemas.js";

/** Small clock skew tolerance for "not in the future". */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

const paymentSelect = {
  id: true,
  invoiceId: true,
  method: true,
  amount: true,
  paidAt: true,
  reference: true,
  note: true,
  createdAt: true,
  recordedBy: { select: { name: true } },
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

function paymentDto(p: PaymentRow, actor: AuthContext) {
  const staff = actor.role !== "CUSTOMER";
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    method: p.method,
    amount: money(p.amount),
    paidAt: p.paidAt,
    reference: p.reference,
    createdAt: p.createdAt,
    ...(staff ? { note: p.note, recordedBy: p.recordedBy?.name ?? null } : {}),
  };
}

/** The invoice's position after the payment: what the UI shows next to the form. */
async function invoiceSummary(id: string) {
  const i = await prisma.invoice.findUniqueOrThrow({ where: { id }, select: { id: true, number: true, status: true, total: true, amountPaid: true, paidAt: true } });
  return { id: i.id, number: i.number, status: i.status, total: money(i.total), amountPaid: money(i.amountPaid), balance: money(i.total.minus(i.amountPaid)), paidAt: i.paidAt };
}

export interface RecordResult {
  payment: ReturnType<typeof paymentDto>;
  invoice: Awaited<ReturnType<typeof invoiceSummary>>;
  /** true when this exact request had already been processed (same Idempotency-Key): nothing new was recorded. */
  replayed: boolean;
}

/**
 * Records a payment against an invoice.
 *
 * Concurrency: the invoice row is locked (SELECT … FOR UPDATE) for the whole transaction, so two payments racing for
 * the last of the balance are serialised and exactly one fits: the other gets OVERPAYMENT. The DB also rejects any
 * state where amountPaid > total, as a final backstop.
 *
 * Retries: with an Idempotency-Key, repeating the request returns the original payment instead of paying twice.
 */
export async function recordPayment(req: Request, invoiceId: string, body: RecordPaymentBody, idempotencyKey?: string): Promise<RecordResult> {
  const actor = auth(req);
  const amount = round2(body.amount);
  const now = new Date();
  const paidAt = body.paidAt ?? now;
  if (paidAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) throw badRequest("The payment date can't be in the future");

  const replay = async (key: string): Promise<RecordResult | null> => {
    const prev = await prisma.payment.findUnique({ where: { idempotencyKey: key }, select: { ...paymentSelect, amount: true } });
    if (!prev) return null;
    if (prev.invoiceId !== invoiceId || !D(prev.amount).equals(amount) || prev.method !== body.method) {
      throw domainError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different payment");
    }
    return { payment: paymentDto(prev, actor), invoice: await invoiceSummary(invoiceId), replayed: true };
  };

  let created: PaymentRow;
  try {
    created = await prisma.$transaction(
      async (tx) => {
        const inv = await lockInvoice(tx, invoiceId);

        // Authoritative replay check: done AFTER taking the lock, so a concurrent twin that just committed is seen.
        if (idempotencyKey) {
          const prev = await tx.payment.findUnique({ where: { idempotencyKey }, select: { id: true } });
          if (prev) throw new ReplayRequested();
        }

        if (inv.status === "DRAFT") throw domainError("NOT_CONFIRMED", "Confirm the invoice before recording payments");
        if (inv.status === "CANCELLED") throw domainError("INVALID_TRANSITION", "This invoice was cancelled; it can't take payments");
        if (inv.status === "PAID") throw domainError("ALREADY_PAID", "This invoice is already paid in full");
        if (paidAt < inv.issueDate) throw badRequest(`The payment date can't be before the invoice was issued (${toDateOnly(inv.issueDate)})`);

        const balance = D(inv.total).minus(inv.amountPaid);
        if (amount.greaterThan(balance)) {
          throw domainError("OVERPAYMENT", `That is more than is owed: the balance is ${balance.toFixed(2)}`, { balance: balance.toFixed(2) });
        }

        const payment = await tx.payment.create({
          data: { invoiceId, method: body.method, amount, paidAt, reference: body.reference, note: body.note, idempotencyKey: idempotencyKey ?? null, recordedById: actor.userId },
          select: paymentSelect,
        });
        const settled = amount.equals(balance);
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { amountPaid: { increment: amount }, ...(settled && { status: "PAID", paidAt }) },
        });
        await audit(req, { action: "payment.record", entityType: "Payment", entityId: payment.id, metadata: { invoiceId, amount: amount.toFixed(2), method: body.method, settled } }, tx);
        return payment;
      },
      { timeout: 20_000 },
    );
  } catch (err) {
    // Twin request won (either seen under the lock, or by the unique index): answer with ITS result.
    if (idempotencyKey && (err instanceof ReplayRequested || (err as { code?: string }).code === "P2002")) {
      const again = await replay(idempotencyKey);
      if (again) return again;
    }
    throw err;
  }

  const invoice = await invoiceSummary(invoiceId);
  void notifyCustomer(invoiceId, amount.toFixed(2), invoice.status === "PAID");
  return { payment: paymentDto(created, actor), invoice, replayed: false };
}

class ReplayRequested extends Error {}

/** Best-effort receipt email. Never affects the payment: it is already committed. */
async function notifyCustomer(invoiceId: string, amount: string, settled: boolean) {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { number: true, billToName: true, billToEmail: true, currency: true, total: true, amountPaid: true } });
  if (!inv) return;
  const fmt = (v: string | Prisma.Decimal) => new Intl.NumberFormat("en-IN", { style: "currency", currency: inv.currency }).format(Number(v));
  const left = inv.total.minus(inv.amountPaid);
  const line = settled ? `Invoice ${inv.number} is now paid in full.` : `Remaining balance on invoice ${inv.number}: ${fmt(left)}.`;
  sendMailBackground({
    to: inv.billToEmail,
    subject: `Payment received – invoice ${inv.number}`,
    text: `Hi ${inv.billToName},\n\nWe received your payment of ${fmt(amount)}. ${line}\n\nView it: ${env.APP_BASE_URL}/my/invoices\n\nThank you!`,
    html: `<p>Hi ${escapeHtml(inv.billToName)},</p><p>We received your payment of <strong>${escapeHtml(fmt(amount))}</strong>. ${escapeHtml(line)}</p><p><a href="${escapeHtml(env.APP_BASE_URL)}/my/invoices">View your invoices</a></p><p>Thank you!</p>`,
  });
}

/** Payments on one invoice, oldest first. Customers can read their own invoice's payments (never drafts). */
export async function listForInvoice(req: Request, invoiceId: string) {
  const actor = auth(req);
  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, ...(actor.role === "CUSTOMER" ? { customerId: actor.customerId ?? "00000000-0000-0000-0000-000000000000", status: { in: ["CONFIRMED", "PAID"] as const } } : {}) },
    select: { id: true },
  });
  if (!inv) throw notFound("Invoice");
  const rows = await prisma.payment.findMany({ where: { invoiceId }, orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }], select: paymentSelect });
  return { items: rows.map((r) => paymentDto(r, actor)), invoice: await invoiceSummary(invoiceId) };
}
