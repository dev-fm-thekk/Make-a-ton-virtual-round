"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "@/lib/api";
import type { Paged } from "@/lib/types";
import type { PaymentTerm, Product, ProductInput, ProductVariant, Tax } from "./types";

/**
 * Catalog data feeds the subscription forms (`/subscriptions/options` is cached for minutes), quotation templates and
 * discounts. After ANY change here we drop those caches so nobody builds a quote from a stale price list.
 */
export function refreshCatalogDependents(qc: QueryClient) {
  for (const key of ["catalog", "subscriptions", "plans", "templates", "discounts"] as const) {
    void qc.invalidateQueries({ queryKey: key === "subscriptions" ? ["subscriptions", "options"] : [key] });
  }
}

type ListParams = { page?: number; search?: string; isActive?: string; type?: string };

// ───────── taxes ─────────
export const useTaxes = (p: ListParams = {}) =>
  useQuery({ queryKey: ["catalog", "taxes", p], queryFn: () => get<Paged<Tax>>("/taxes", { limit: 50, ...p }), placeholderData: keepPreviousData });

export function useTaxMutations() {
  const qc = useQueryClient();
  const done = { onSuccess: () => refreshCatalogDependents(qc) };
  return {
    create: useMutation({ mutationFn: (v: { name: string; ratePercent: string; isActive: boolean }) => post<{ tax: Tax }>("/taxes", v), ...done }),
    update: useMutation({ mutationFn: (v: { id: string; patch: Partial<{ name: string; ratePercent: string; isActive: boolean }> }) => patch<{ tax: Tax }>(`/taxes/${v.id}`, v.patch), ...done }),
    remove: useMutation({ mutationFn: (id: string) => del(`/taxes/${id}`), ...done }),
  };
}

// ───────── payment terms ─────────
export const usePaymentTerms = (p: { page?: number; search?: string } = {}) =>
  useQuery({ queryKey: ["catalog", "terms", p], queryFn: () => get<Paged<PaymentTerm>>("/payment-terms", { limit: 100, ...p }), placeholderData: keepPreviousData });

export function usePaymentTermMutations() {
  const qc = useQueryClient();
  const done = { onSuccess: () => refreshCatalogDependents(qc) };
  return {
    create: useMutation({ mutationFn: (v: { name: string; dueDays: number; isDefault: boolean }) => post<{ paymentTerm: PaymentTerm }>("/payment-terms", v), ...done }),
    update: useMutation({ mutationFn: (v: { id: string; patch: Partial<{ name: string; dueDays: number; isDefault: boolean }> }) => patch<{ paymentTerm: PaymentTerm }>(`/payment-terms/${v.id}`, v.patch), ...done }),
    remove: useMutation({ mutationFn: (id: string) => del(`/payment-terms/${id}`), ...done }),
  };
}

// ───────── products & variants ─────────
export const useProducts = (p: ListParams = {}) =>
  useQuery({ queryKey: ["catalog", "products", p], queryFn: () => get<Paged<Product>>("/products", { limit: 20, ...p }), placeholderData: keepPreviousData });

export const useProduct = (id: string) => useQuery({ queryKey: ["catalog", "product", id], queryFn: () => get<{ product: Product }>(`/products/${id}`).then((r) => r.product) });

export function useProductMutations() {
  const qc = useQueryClient();
  const done = { onSuccess: () => refreshCatalogDependents(qc) };
  return {
    create: useMutation({ mutationFn: (v: ProductInput) => post<{ product: Product }>("/products", v).then((r) => r.product), ...done }),
    update: useMutation({ mutationFn: (v: { id: string; patch: Partial<ProductInput> }) => patch<{ product: Product }>(`/products/${v.id}`, v.patch).then((r) => r.product), ...done }),
    remove: useMutation({ mutationFn: (id: string) => del(`/products/${id}`), ...done }),
    createVariant: useMutation({ mutationFn: (v: { productId: string; attribute: string; value: string; extraPrice: string; isActive: boolean }) => post<{ variant: ProductVariant }>(`/products/${v.productId}/variants`, { attribute: v.attribute, value: v.value, extraPrice: v.extraPrice, isActive: v.isActive }), ...done }),
    updateVariant: useMutation({ mutationFn: (v: { productId: string; id: string; patch: Partial<{ attribute: string; value: string; extraPrice: string; isActive: boolean }> }) => patch<{ variant: ProductVariant }>(`/products/${v.productId}/variants/${v.id}`, v.patch), ...done }),
    removeVariant: useMutation({ mutationFn: (v: { productId: string; id: string }) => del(`/products/${v.productId}/variants/${v.id}`), ...done }),
  };
}
