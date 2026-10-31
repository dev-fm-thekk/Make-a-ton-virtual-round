"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import type { GroupBy, InvoicesReport, InvoiceState, OverdueReport, PaymentsReport, RevenueSeries, SubscriptionsReport, Summary } from "./types";

// Reports are live numbers: a short stale time keeps navigation snappy without showing yesterday's balance.
const opts = { staleTime: 30_000, placeholderData: keepPreviousData } as const;

export const useSummary = (from: string, to: string) =>
  useQuery({ queryKey: ["reports", "summary", from, to], queryFn: () => get<Summary>("/reports/summary", { from, to }), ...opts });

export const useRevenue = (from: string, to: string, groupBy: GroupBy) =>
  useQuery({ queryKey: ["reports", "revenue", from, to, groupBy], queryFn: () => get<RevenueSeries>("/reports/revenue", { from, to, groupBy }), ...opts });

export const useOverdue = (p: { page?: number; limit?: number; customerId?: string; minDaysOverdue?: string; sort?: string }) =>
  useQuery({ queryKey: ["reports", "overdue", p], queryFn: () => get<OverdueReport>("/reports/overdue", { limit: 20, ...p }), ...opts });

export const useInvoicesReport = (p: { page?: number; state: InvoiceState; from?: string; to?: string; search?: string; sort?: string }) =>
  useQuery({ queryKey: ["reports", "invoices", p], queryFn: () => get<InvoicesReport>("/reports/invoices", { limit: 20, ...p }), ...opts });

export const usePaymentsReport = (p: { page?: number; from?: string; to?: string; method?: string; search?: string; sort?: string }) =>
  useQuery({ queryKey: ["reports", "payments", p], queryFn: () => get<PaymentsReport>("/reports/payments", { limit: 20, ...p }), ...opts });

export const useSubscriptionsReport = (p: { page?: number; limit?: number; status?: string; sort?: string }) =>
  useQuery({ queryKey: ["reports", "subscriptions", p], queryFn: () => get<SubscriptionsReport>("/reports/subscriptions", { limit: 20, ...p }), ...opts });
