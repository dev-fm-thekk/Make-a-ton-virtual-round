// Values derived from an invoice's stored fields: pure, no environment or database needed.

import type { InvoiceStatus } from "../../generated/prisma/client.js";

export type PaymentState = "draft" | "cancelled" | "paid" | "overdue" | "outstanding";

/** What a person looking at the invoice cares about. Overdue is derived from the due date, never stored. */
export function paymentState(status: InvoiceStatus, dueDate: Date, today: Date): PaymentState {
  if (status === "DRAFT") return "draft";
  if (status === "CANCELLED") return "cancelled";
  if (status === "PAID") return "paid";
  return dueDate < today ? "overdue" : "outstanding";
}
