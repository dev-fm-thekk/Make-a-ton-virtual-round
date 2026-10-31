import { Badge } from "@/components/ui";
import type { InvoiceAction, PaymentMethod, PaymentState } from "./types";

const TONE: Record<PaymentState, "neutral" | "primary" | "success" | "danger" | "warning"> = {
  draft: "neutral",
  outstanding: "warning",
  overdue: "danger",
  paid: "success",
  cancelled: "neutral",
};

export const STATE_LABEL: Record<PaymentState, string> = {
  draft: "Draft",
  outstanding: "Awaiting payment",
  overdue: "Overdue",
  paid: "Paid",
  cancelled: "Cancelled",
};

/** Always text + colour (never colour alone). */
export function InvoiceStateBadge({ state }: { state: PaymentState }) {
  return <Badge tone={TONE[state]}>{STATE_LABEL[state]}</Badge>;
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { CASH: "Cash", BANK_TRANSFER: "Bank transfer", CARD: "Card", UPI: "UPI", CHEQUE: "Cheque", OTHER: "Other" };
export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[];

export const ACTION_LABEL: Record<InvoiceAction, string> = {
  confirm: "Confirm invoice",
  cancel: "Cancel invoice",
  send: "Send to customer",
  record_payment: "Record payment",
  reissue: "Reissue",
};

/** Server error codes → plain language (falls back to the server's message). */
export const INVOICE_ERRORS: Record<string, string> = {
  INVALID_TRANSITION: "That isn't possible from the invoice's current status.",
  NOT_CONFIRMED: "Confirm the invoice first.",
  HAS_PAYMENTS: "This invoice already has payments, so it can't be cancelled.",
  PERIOD_ALREADY_INVOICED: "That billing period already has a live invoice.",
  ALREADY_PAID: "This invoice is already paid in full.",
  OVERPAYMENT: "That's more than is still owed on this invoice.",
  IDEMPOTENCY_KEY_REUSED: "This payment was already submitted with different details. Close the dialog and start again.",
  MAIL_FAILED: "The email could not be delivered right now. Try again in a moment.",
};
