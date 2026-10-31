"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, get, post } from "@/lib/api";
import type { InvoiceDetail, InvoiceListParams, InvoicesPage, PaymentInput, InvoicePayment } from "./types";

export const invoiceKeys = {
  list: (p: InvoiceListParams) => ["invoices", "list", p] as const,
  detail: (id: string) => ["invoices", "detail", id] as const,
};

export function useInvoices(params: InvoiceListParams, enabled = true) {
  return useQuery({
    queryKey: invoiceKeys.list(params),
    queryFn: () => get<InvoicesPage>("/invoices", { limit: 20, ...params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useInvoice(id: string) {
  return useQuery({ queryKey: invoiceKeys.detail(id), queryFn: () => get<{ invoice: InvoiceDetail }>(`/invoices/${id}`).then((r) => r.invoice) });
}

/** Anything that changes money or status must refresh every screen that shows it. */
function refreshRelated(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["invoices", "list"] });
  void qc.invalidateQueries({ queryKey: ["reports"] });
  void qc.invalidateQueries({ queryKey: ["customers"] });
  void qc.invalidateQueries({ queryKey: ["billing"] });
}

function useInvoiceMutation<V>(fn: (v: V) => Promise<{ invoice: InvoiceDetail }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: ({ invoice }) => {
      qc.setQueryData(invoiceKeys.detail(invoice.id), invoice);
      refreshRelated(qc);
    },
  });
}

export const useConfirmInvoice = () => useInvoiceMutation((id: string) => post<{ invoice: InvoiceDetail }>(`/invoices/${id}/confirm`));
export const useCancelInvoice = () => useInvoiceMutation((v: { id: string; reason: string }) => post<{ invoice: InvoiceDetail }>(`/invoices/${v.id}/cancel`, { reason: v.reason }));
export const useSendInvoice = () => useInvoiceMutation((id: string) => post<{ invoice: InvoiceDetail }>(`/invoices/${id}/send`));
export const useReissueInvoice = () => useInvoiceMutation((id: string) => post<{ invoice: InvoiceDetail }>(`/invoices/${id}/reissue`));

export function useBulkConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ids?: string[]; billingRunId?: string }) => post<{ confirmed: number; failed: { id: string; error: string }[]; more: boolean }>("/invoices/bulk-confirm", v),
    onSuccess: () => refreshRelated(qc),
  });
}

export interface RecordPaymentResult {
  payment: InvoicePayment;
  invoice: { id: string; number: string | null; status: string; total: string; amountPaid: string; balance: string };
  replayed: boolean;
}

/**
 * `idempotencyKey` is generated once per open dialog, so a retry after a timeout or a double-click can never record
 * the payment twice: the server answers the repeat with the original payment.
 */
export function useRecordPayment(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { body: PaymentInput; idempotencyKey: string }) =>
      api<RecordPaymentResult>("POST", `/invoices/${invoiceId}/payments`, { body: v.body, headers: { "idempotency-key": v.idempotencyKey } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invoiceKeys.detail(invoiceId) });
      refreshRelated(qc);
    },
  });
}
