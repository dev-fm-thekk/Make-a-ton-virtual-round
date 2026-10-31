"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, patch, post, api } from "@/lib/api";
import type { FormOptions, LinePayload, ListParams, SubscriptionAction, SubscriptionDetail, SubscriptionPage } from "./types";

export const subscriptionKeys = {
  all: ["subscriptions"] as const,
  list: (p: ListParams) => ["subscriptions", "list", p] as const,
  detail: (id: string) => ["subscriptions", "detail", id] as const,
  options: ["subscriptions", "options"] as const,
};

export function useSubscriptions(params: ListParams, enabled = true) {
  return useQuery({
    queryKey: subscriptionKeys.list(params),
    queryFn: () => get<SubscriptionPage>("/subscriptions", { limit: 20, ...params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSubscription(id: string) {
  return useQuery({
    queryKey: subscriptionKeys.detail(id),
    queryFn: () => get<{ subscription: SubscriptionDetail }>(`/subscriptions/${id}`).then((r) => r.subscription),
  });
}

/** Plans, terms, products, templates and taxes for the forms: one request, cached for the session. */
export function useFormOptions() {
  return useQuery({
    queryKey: subscriptionKeys.options,
    queryFn: () => get<FormOptions>("/subscriptions/options"),
    staleTime: 5 * 60_000,
  });
}

export interface CreateSubscriptionInput {
  customerId: string;
  planId?: string;
  quotationTemplateId?: string;
  paymentTermId?: string;
  startDate: string;
  expiryDate?: string;
  notes?: string;
  lines?: LinePayload[];
}

/** Every mutation returns the fresh subscription, so we write it straight into the detail cache. */
function useSubscriptionMutation<V>(fn: (v: V) => Promise<{ subscription: SubscriptionDetail }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: ({ subscription }) => {
      qc.setQueryData(subscriptionKeys.detail(subscription.id), subscription);
      void qc.invalidateQueries({ queryKey: ["subscriptions", "list"] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export const useCreateSubscription = () => useSubscriptionMutation((v: CreateSubscriptionInput) => post<{ subscription: SubscriptionDetail }>("/subscriptions", v));

export const useUpdateSubscription = (id: string) =>
  useSubscriptionMutation((v: { version: number; paymentTermId?: string; startDate?: string; expiryDate?: string | null; notes?: string | null; planId?: string }) =>
    patch<{ subscription: SubscriptionDetail }>(`/subscriptions/${id}`, v),
  );

export const useReplaceLines = (id: string) =>
  useSubscriptionMutation((v: { version: number; lines: LinePayload[] }) => api<{ subscription: SubscriptionDetail }>("PUT", `/subscriptions/${id}/lines`, { body: v }));

export const useTransition = (id: string) =>
  useSubscriptionMutation((v: { action: SubscriptionAction; version: number; reason?: string; expiryDate?: string }) =>
    post<{ subscription: SubscriptionDetail }>(`/subscriptions/${id}/transition`, v),
  );
