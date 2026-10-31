"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "@/lib/api";
import type { Paged } from "@/lib/types";
import type { BillingPeriod } from "@/features/subscriptions/types";

export interface TemplateLine {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  unitPrice: string;
  amount: string;
}

export interface Template {
  id: string;
  name: string;
  planId: string;
  plan: { id: string; name: string; billingPeriod: BillingPeriod; billingInterval: number };
  validityDays: number;
  notes: string | null;
  isActive: boolean;
  lines: TemplateLine[];
  /** Per billing period, before tax and discounts, at today's catalog prices. */
  estimatedUntaxed: string;
  usable: boolean;
  /** Plain-language reasons the template cannot be used right now (inactive product, plan expired, ...). */
  problems: string[];
}

export interface TemplateLineInput {
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface TemplateInput {
  name: string;
  planId: string;
  validityDays: number;
  notes: string | null;
  isActive: boolean;
  lines: TemplateLineInput[];
}

type ListParams = { page?: number; search?: string; planId?: string; isActive?: string };

export const useTemplates = (p: ListParams = {}) =>
  useQuery({ queryKey: ["templates", "list", p], queryFn: () => get<Paged<Template>>("/quotation-templates", { limit: 20, ...p }), placeholderData: keepPreviousData });

export const useTemplate = (id: string | undefined) =>
  useQuery({ queryKey: ["templates", "one", id], enabled: !!id, queryFn: () => get<{ template: Template }>(`/quotation-templates/${id}`).then((r) => r.template) });

export function useTemplateMutations() {
  const qc = useQueryClient();
  const done = {
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["templates"] });
      void qc.invalidateQueries({ queryKey: ["subscriptions", "options"] });
      void qc.invalidateQueries({ queryKey: ["plans"] });
    },
  };
  return {
    create: useMutation({ mutationFn: (v: TemplateInput) => post<{ template: Template }>("/quotation-templates", v).then((r) => r.template), ...done }),
    update: useMutation({ mutationFn: (v: { id: string; patch: Partial<TemplateInput> }) => patch<{ template: Template }>(`/quotation-templates/${v.id}`, v.patch).then((r) => r.template), ...done }),
    remove: useMutation({ mutationFn: (id: string) => del(`/quotation-templates/${id}`), ...done }),
  };
}
