import type { Paged } from "@/lib/types";

export type InvoiceStatus = "DRAFT" | "CONFIRMED" | "PAID" | "CANCELLED";
/** Derived by the API from status + due date; "overdue" is never stored. */
export type PaymentState = "draft" | "cancelled" | "paid" | "overdue" | "outstanding";
export type InvoiceAction = "confirm" | "cancel" | "send" | "record_payment" | "reissue";
export type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "UPI" | "CHEQUE" | "OTHER";

export interface InvoiceListItem {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  paymentState: PaymentState;
  customer: { id: string; name: string; companyName: string | null };
  subscription: { id: string; number: string };
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  total: string;
  amountPaid: string;
  balance: string;
  sentAt: string | null;
}

export type InvoicesPage = Paged<InvoiceListItem> & { totals: { invoices: number; total: string; paid: string; balance: string } };

export interface InvoiceLine {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: string;
  discountAmount: string;
  taxRatePercent: string;
  taxAmount: string;
  lineTotal: string;
}

export interface InvoicePayment {
  id: string;
  method: PaymentMethod;
  amount: string;
  paidAt: string;
  reference: string | null;
  /** Staff only. */
  note?: string | null;
  recordedBy?: string | null;
}

export interface InvoiceDetail {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  paymentState: PaymentState;
  customer: { id: string; name: string; companyName: string | null };
  subscription: { id: string; number: string };
  paymentTerm: string;
  billTo: { name: string; email: string; address: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string } | null; taxId: string | null };
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  balance: string;
  lines: InvoiceLine[];
  discounts: { id: string; name: string; amount: string }[];
  payments: InvoicePayment[];
  sentAt: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  /** Staff only. */
  notes?: string | null;
  billingRunId?: string | null;
  availableActions: InvoiceAction[];
  createdAt: string;
}

export interface InvoiceListParams {
  page?: number;
  limit?: number;
  status?: string;
  overdue?: string;
  customerId?: string;
  subscriptionId?: string;
  billingRunId?: string;
  search?: string;
  sort?: string;
}

export interface PaymentInput {
  method: PaymentMethod;
  amount: string;
  paidAt?: string;
  reference?: string;
  note?: string;
}
