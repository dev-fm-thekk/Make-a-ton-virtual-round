"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "@/lib/api";
import type { Paged } from "@/lib/types";
import type { Customer, CustomerDetail, CustomerInput, CustomerListItem } from "./types";

export const customerKeys = {
  list: (p: object) => ["customers", "list", p] as const,
  detail: (id: string) => ["customers", "detail", id] as const,
  profile: ["customers", "me"] as const,
};

export interface CustomerListParams {
  page?: number;
  search?: string;
  hasPortalAccess?: string;
  sort?: string;
}

export function useCustomers(params: CustomerListParams) {
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: () => get<Paged<CustomerListItem>>("/customers", { limit: 20, ...params }),
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: string) {
  // `enabled` lets callers pass an empty id (e.g. an optional ?customerId=) without firing a request
  return useQuery({ queryKey: customerKeys.detail(id), queryFn: () => get<{ customer: CustomerDetail }>(`/customers/${id}`).then((r) => r.customer), enabled: !!id });
}

/** Typeahead for pickers: only fires once there is something to search. */
export function useCustomerSearch(search: string) {
  return useQuery({
    queryKey: customerKeys.list({ picker: search }),
    queryFn: () => get<Paged<CustomerListItem>>("/customers", { limit: 8, search }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CustomerInput) => post<{ customer: Customer }>("/customers", v).then((r) => r.customer),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useUpdateCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Partial<CustomerInput>) => patch<{ customer: CustomerDetail }>(`/customers/${id}`, v).then((r) => r.customer),
    onSuccess: (c) => {
      qc.setQueryData(customerKeys.detail(id), c);
      void qc.invalidateQueries({ queryKey: ["customers", "list"] });
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/customers/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

// ───────── a customer's own profile (portal) ─────────
export type OwnProfile = Omit<Customer, "notes">;

export function useOwnProfile(enabled: boolean) {
  return useQuery({ queryKey: customerKeys.profile, queryFn: () => get<{ profile: OwnProfile }>("/me/profile").then((r) => r.profile), enabled });
}

export function useUpdateOwnProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Partial<Pick<CustomerInput, "name" | "companyName" | "phone" | "taxId" | "billingAddress">>) => patch<{ profile: OwnProfile }>("/me/profile", v).then((r) => r.profile),
    onSuccess: (p) => qc.setQueryData(customerKeys.profile, p),
  });
}
