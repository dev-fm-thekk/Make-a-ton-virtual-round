"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "@/lib/api";
import type { Paged } from "@/lib/types";
import type { BillingPeriod } from "@/features/subscriptions/types";

export interface Plan {
  id: string;
  name: string;
  price: string;
  billingPeriod: BillingPeriod;
  billingInterval: number;
  minQuantity: number;
  availableFrom: string;
  availableUntil: string | null;
  autoCloseOnEnd: boolean;
  allowEarlyClose: boolean;
  allowPause: boolean;
  allowRenewal: boolean;
  isActive: boolean;
  /** Subscriptions currently billing on this plan; while > 0 the billing cycle is locked. */
  liveSubscriptions: number;
}

export interface PlanInput {
  name: string;
  price: string;
  billingPeriod: BillingPeriod;
  billingInterval: number;
  minQuantity: number;
  availableFrom: string;
  availableUntil: string | null;
  autoCloseOnEnd: boolean;
  allowEarlyClose: boolean;
  allowPause: boolean;
  allowRenewal: boolean;
  isActive: boolean;
}

type ListParams = { page?: number; search?: string; billingPeriod?: string; isActive?: string; limit?: number };

export const usePlans = (p: ListParams = {}) =>
  useQuery({ queryKey: ["plans", "list", p], queryFn: () => get<Paged<Plan>>("/plans", { limit: 20, ...p }), placeholderData: keepPreviousData });

export function usePlanMutations() {
  const qc = useQueryClient();
  // Subscription forms read plans through /subscriptions/options, and templates embed plan names.
  const done = {
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["plans"] });
      void qc.invalidateQueries({ queryKey: ["templates"] });
      void qc.invalidateQueries({ queryKey: ["subscriptions", "options"] });
    },
  };
  return {
    create: useMutation({ mutationFn: (v: PlanInput) => post<{ plan: Plan }>("/plans", v).then((r) => r.plan), ...done }),
    update: useMutation({ mutationFn: (v: { id: string; patch: Partial<PlanInput> }) => patch<{ plan: Plan }>(`/plans/${v.id}`, v.patch).then((r) => r.plan), ...done }),
    remove: useMutation({ mutationFn: (id: string) => del(`/plans/${id}`), ...done }),
  };
}
