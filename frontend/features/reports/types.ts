import type { Paged } from "@/lib/types";
import type { SubscriptionStatus } from "../subscriptions/types";

export interface Summary {
  range: { from: string; to: string };
  asOf: string;
  subscriptions: { active: number; byStatus: Record<SubscriptionStatus, number>; activatedInRange: number; closedInRange: number };
  recurringRevenue: { mrr: string; arr: string };
  revenue: { collected: string; payments: number };
  invoiced: { total: string; invoices: number; paidInFull: number };
  outstanding: { amount: string; invoices: number; overdueAmount: string; overdueInvoices: number };
}

export type GroupBy = "day" | "week" | "month";

export interface RevenuePoint {
  bucket: string;
  collected: string;
  payments: number;
  invoiced: string;
  invoices: number;
}
export interface RevenueSeries {
  range: { from: string; to: string };
  groupBy: GroupBy;
  points: RevenuePoint[];
  totals: { collected: string; invoiced: string };
}

export interface AgingBucket {
  bucket: string;
  invoices: number;
  amount: string;
}
export interface CustomerRef {
  id: string;
  name: string;
  companyName: string | null;
}
export interface OverdueItem {
  id: string;
  number: string | null;
  customer: CustomerRef & { email?: string };
  subscription: { id: string; number: string };
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  total: string;
  amountPaid: string;
  balance: string;
}
export type OverdueReport = Paged<OverdueItem> & { asOf: string; summary: { invoices: number; amount: string; aging: AgingBucket[] } };

export type InvoiceState = "all" | "paid" | "outstanding" | "overdue";
export interface InvoiceItem {
  id: string;
  number: string | null;
  status: "CONFIRMED" | "PAID";
  paymentState: "paid" | "outstanding" | "overdue";
  customer: CustomerRef;
  subscription: { id: string; number: string };
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  total: string;
  amountPaid: string;
  balance: string;
}
export type InvoicesReport = Paged<InvoiceItem> & { asOf: string; totals: { invoices: number; total: string; paid: string; balance: string } };

export type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "UPI" | "CHEQUE" | "OTHER";
export interface PaymentItem {
  id: string;
  method: PaymentMethod;
  amount: string;
  paidAt: string;
  reference: string | null;
  note: string | null;
  invoice: { id: string; number: string | null };
  customer: CustomerRef;
}
export type PaymentsReport = Paged<PaymentItem> & { totals: { payments: number; amount: string }; byMethod: { method: PaymentMethod; payments: number; amount: string }[] };

export interface SubscriptionReportItem {
  id: string;
  number: string;
  status: SubscriptionStatus;
  customer: { id: string; name: string };
  plan: { id: string; name: string; billingPeriod: string; billingInterval: number };
  startDate: string;
  expiryDate: string | null;
  nextBillingDate: string | null;
  amountPerPeriod: string;
  mrr: string;
}
export type SubscriptionsReport = Paged<SubscriptionReportItem> & {
  summary: { byStatus: Record<SubscriptionStatus, number>; mrr: string; mrrByPlan: { planId: string; planName: string; subscriptions: number; mrr: string }[] };
};
