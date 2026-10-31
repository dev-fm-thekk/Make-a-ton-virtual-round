import type { Paged } from "@/lib/types";

export type SubscriptionStatus = "DRAFT" | "QUOTATION" | "CONFIRMED" | "ACTIVE" | "PAUSED" | "CLOSED";
export type SubscriptionAction = "send_quotation" | "confirm" | "activate" | "pause" | "resume" | "close" | "renew";
export type BillingPeriod = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export const STATUSES: SubscriptionStatus[] = ["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "PAUSED", "CLOSED"];

export interface PlanSummary {
  id: string;
  name: string;
  price: string;
  billingPeriod: BillingPeriod;
  billingInterval: number;
  minQuantity: number;
  allowPause: boolean;
  allowEarlyClose: boolean;
  allowRenewal: boolean;
  autoCloseOnEnd: boolean;
}

export interface Totals {
  untaxed: string;
  tax: string;
  total: string;
}

export interface SubscriptionListItem {
  id: string;
  number: string;
  status: SubscriptionStatus;
  startDate: string;
  expiryDate: string | null;
  nextBillingDate: string | null;
  createdAt: string;
  customer: { id: string; name: string; companyName: string | null };
  plan: Pick<PlanSummary, "id" | "name" | "billingPeriod" | "billingInterval">;
  lineCount: number;
  totals: Totals;
}

export interface SubscriptionLine {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantLabel: string | null;
  description: string;
  quantity: number;
  unitPrice: string;
  taxId: string | null;
  taxName: string | null;
  taxRatePercent: string;
  amount: string;
  taxAmount: string;
  total: string;
}

export interface HistoryEntry {
  from: SubscriptionStatus | null;
  to: SubscriptionStatus;
  reason: string | null;
  by: string | null;
  at: string;
}

export interface SubscriptionDetail {
  id: string;
  number: string;
  status: SubscriptionStatus;
  version: number;
  customer: { id: string; name: string; companyName: string | null; email: string };
  plan: PlanSummary;
  paymentTerm: { id: string; name: string; dueDays: number };
  quotationTemplateId: string | null;
  startDate: string;
  expiryDate: string | null;
  quoteValidUntil: string | null;
  nextBillingDate: string | null;
  activatedAt: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  /** Only present for staff. */
  notes?: string | null;
  lines: SubscriptionLine[];
  totals: Totals;
  history: HistoryEntry[];
  availableActions: SubscriptionAction[];
  createdAt: string;
  updatedAt: string;
}

export interface ListParams {
  page?: number;
  limit?: number;
  status?: string;
  customerId?: string;
  planId?: string;
  search?: string;
  sort?: string;
}
export type SubscriptionPage = Paged<SubscriptionListItem>;

// ───────── form options (GET /subscriptions/options) ─────────
export interface FormOptions {
  plans: (PlanSummary & { availableFrom: string; availableUntil: string | null })[];
  paymentTerms: { id: string; name: string; dueDays: number; isDefault: boolean }[];
  products: { id: string; name: string; type: string; salesPrice: string; taxId: string | null; variants: { id: string; attribute: string; value: string; extraPrice: string }[] }[];
  templates: { id: string; name: string; planId: string; validityDays: number; lines: { productId: string; variantId: string | null; quantity: number }[] }[];
  taxes: { id: string; name: string; ratePercent: string }[];
}

/** One editable line in the form / line editor. `unitPrice === ""` means "use the catalog price". */
export interface DraftLine {
  key: string;
  productId: string;
  variantId: string;
  quantity: number;
  unitPrice: string;
  /** "" = product default, "none" = untaxed, otherwise a tax id. */
  taxChoice: string;
}

export interface LinePayload {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice?: string;
  taxId?: string | null;
}
