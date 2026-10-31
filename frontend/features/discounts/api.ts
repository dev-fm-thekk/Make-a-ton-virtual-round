"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "@/lib/api";
import type { Paged } from "@/lib/types";

export type DiscountType = "FIXED" | "PERCENTAGE";
export type DiscountScope = "PRODUCT" | "SUBSCRIPTION";
export type DiscountStatus = "inactive" | "scheduled" | "active" | "expired" | "exhausted";

export interface Discount {
  id: string;
  name: string;
  type: DiscountType;
  value: string;
  scope: DiscountScope;
  minPurchaseAmount: string | null;
  minQuantity: number | null;
  startDate: string;
  endDate: string | null;
  usageLimit: number | null;
  usedCount: number;
  remainingUses: number | null;
  isActive: boolean;
  status: DiscountStatus;
  products: { id: string; name: string }[];
  attachedSubscriptions: number;
  redemptions: number;
}

export interface DiscountInput {
  name: string;
  type: DiscountType;
  value: string;
  scope: DiscountScope;
  minPurchaseAmount: string | null;
  minQuantity: number | null;
  startDate: string;
  endDate: string | null;
  usageLimit: number | null;
  isActive: boolean;
  productIds: string[];
}

export interface Redemption {
  id: string;
  amount: string;
  at: string;
  invoice: { id: string; number: string; status: string };
  customer: { id: string; name: string };
  subscription: { id: string; number: string } | null;
}

export interface AttachedDiscount {
  attachedAt: string;
  discount: Discount;
}

type ListParams = { page?: number; limit?: number; search?: string; status?: string; scope?: string };

export const useDiscounts = (p: ListParams = {}) =>
  useQuery({ queryKey: ["discounts", "list", p], queryFn: () => get<Paged<Discount>>("/discounts", { limit: 20, ...p }), placeholderData: keepPreviousData });

export const useDiscount = (id: string) => useQuery({ queryKey: ["discounts", "one", id], queryFn: () => get<{ discount: Discount }>(`/discounts/${id}`).then((r) => r.discount) });

export const useRedemptions = (id: string, page: number) =>
  useQuery({ queryKey: ["discounts", "redemptions", id, page], queryFn: () => get<Paged<Redemption>>(`/discounts/${id}/redemptions`, { page, limit: 10 }), placeholderData: keepPreviousData });

export const useSubscriptionDiscounts = (subscriptionId: string) =>
  useQuery({ queryKey: ["discounts", "subscription", subscriptionId], queryFn: () => get<{ items: AttachedDiscount[] }>(`/discounts/for-subscription/${subscriptionId}`).then((r) => r.items) });

export function useDiscountMutations() {
  const qc = useQueryClient();
  // A changed discount changes what a subscription's preview and next invoice will show.
  const done = { onSuccess: () => void qc.invalidateQueries({ queryKey: ["discounts"] }) };
  return {
    create: useMutation({ mutationFn: (v: DiscountInput) => post<{ discount: Discount }>("/discounts", v).then((r) => r.discount), ...done }),
    update: useMutation({ mutationFn: (v: { id: string; patch: Partial<DiscountInput> }) => patch<{ discount: Discount }>(`/discounts/${v.id}`, v.patch).then((r) => r.discount), ...done }),
    remove: useMutation({ mutationFn: (id: string) => del(`/discounts/${id}`), ...done }),
    detachProduct: useMutation({ mutationFn: (v: { id: string; productId: string }) => del(`/discounts/${v.id}/products/${v.productId}`), ...done }),
    attachToSubscription: useMutation({ mutationFn: (v: { id: string; subscriptionId: string }) => post(`/discounts/${v.id}/subscriptions`, { subscriptionId: v.subscriptionId }), ...done }),
    detachFromSubscription: useMutation({ mutationFn: (v: { id: string; subscriptionId: string }) => del(`/discounts/${v.id}/subscriptions/${v.subscriptionId}`), ...done }),
  };
}
