// Invoice state transitions that more than one module needs (the billing engine auto-confirms,
// the API confirms/cancels by hand). Kept free of HTTP so it can run inside any transaction.
//
//   DRAFT ──confirm──▶ CONFIRMED ──(payments reach the total)──▶ PAID
//     │                    │
//     └────cancel──────────┴── (only while nothing has been paid) ──▶ CANCELLED

import type { InvoiceStatus } from "../../generated/prisma/client.js";
import { domainError, notFound } from "../../lib/errors.js";
import { nextDocumentNumber, type Tx } from "../../lib/shared.js";

export interface LockedInvoice {
  id: string;
  status: InvoiceStatus;
  total: string;
  amountPaid: string;
  issueDate: Date;
  subscriptionId: string;
}

/** Row-lock the invoice for the rest of the transaction: concurrent confirm / cancel / payment attempts queue up behind it. */
export async function lockInvoice(tx: Tx, id: string): Promise<LockedInvoice> {
  const rows = await tx.$queryRaw<{ id: string; status: InvoiceStatus; total: string; amountPaid: string; issueDate: Date; subscriptionId: string }[]>`
    SELECT "id", "status", "total"::text AS total, "amountPaid"::text AS "amountPaid", "issueDate", "subscriptionId"
    FROM "invoices" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw notFound("Invoice");
  return row;
}

/**
 * DRAFT → CONFIRMED: assigns the legal invoice number (gap-free per year) and timestamps it.
 * A zero-value invoice (e.g. fully discounted) has nothing to collect, so it goes straight to PAID.
 */
export async function confirmDraft(tx: Tx, id: string, now = new Date()) {
  const inv = await lockInvoice(tx, id);
  if (inv.status !== "DRAFT") {
    throw domainError("INVALID_TRANSITION", `Only draft invoices can be confirmed (this one is ${inv.status.toLowerCase()})`, { status: inv.status });
  }
  const number = await nextDocumentNumber(tx, "INV", inv.issueDate);
  const free = Number(inv.total) === 0;
  return tx.invoice.update({
    where: { id },
    data: { number, status: free ? "PAID" : "CONFIRMED", confirmedAt: now, ...(free && { paidAt: now }) },
    select: { id: true, number: true, status: true },
  });
}

/**
 * DRAFT or unpaid CONFIRMED → CANCELLED, and give back any discount uses the invoice consumed so a
 * cancelled invoice doesn't burn a limited promotion. Paid invoices can't be cancelled (money has moved).
 */
export async function cancelInvoice(tx: Tx, id: string, now = new Date()) {
  const inv = await lockInvoice(tx, id);
  if (inv.status !== "DRAFT" && inv.status !== "CONFIRMED") {
    throw domainError("INVALID_TRANSITION", `A ${inv.status.toLowerCase()} invoice can't be cancelled`, { status: inv.status });
  }
  if (Number(inv.amountPaid) > 0) {
    throw domainError("HAS_PAYMENTS", "This invoice already has payments recorded, so it can't be cancelled", { amountPaid: inv.amountPaid });
  }

  const redemptions = await tx.discountRedemption.findMany({ where: { invoiceId: id }, select: { discountId: true } });
  for (const r of redemptions) {
    await tx.$executeRaw`UPDATE "discounts" SET "usedCount" = GREATEST("usedCount" - 1, 0), "updatedAt" = now() WHERE "id" = ${r.discountId}::uuid`;
  }
  await tx.discountRedemption.deleteMany({ where: { invoiceId: id } });

  return tx.invoice.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now }, select: { id: true, number: true, status: true } });
}
