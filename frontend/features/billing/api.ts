"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, patch, post } from "@/lib/api";
import type { Paged } from "@/lib/types";

export type RunStatus = "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";

export interface BillingRun {
  id: string;
  runDate: string;
  status: RunStatus;
  /** "scheduler" or a user id */
  triggeredBy: string | null;
  scanned: number;
  invoiced: number;
  skipped: number;
  failed: number;
  errors: { subscriptionId: string; subscription: string; error: string }[] | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface BillingRunDetail extends BillingRun {
  invoicedTotal: string;
  confirmed: number;
}

export interface BillingPreview {
  asOf: string;
  dueSubscriptions: number;
  estimatedTotal: string;
  oldestDue: string | null;
}

export const usePreview = () => useQuery({ queryKey: ["billing", "preview"], queryFn: () => get<BillingPreview>("/billing/preview"), staleTime: 10_000 });

export const useRuns = (page: number, refetchWhileRunning = false) =>
  useQuery({
    queryKey: ["billing", "runs", page],
    queryFn: () => get<Paged<BillingRun>>("/billing/runs", { page, limit: 10 }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (refetchWhileRunning && q.state.data?.items.some((r) => r.status === "RUNNING") ? 3000 : false),
  });

/** Polls while the run is still working, then stops. */
export const useRun = (id: string | null) =>
  useQuery({
    queryKey: ["billing", "run", id],
    queryFn: () => get<{ run: BillingRunDetail }>(`/billing/runs/${id}`).then((r) => r.run),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "RUNNING" ? 2000 : false),
  });

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { asOf?: string; autoConfirm: boolean }) => post<{ run: BillingRunDetail }>("/billing/run", v).then((r) => r.run),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["billing"] }),
  });
}

// ───────── daily scheduler settings ─────────

export type ScheduleState = "off" | "waiting" | "due" | "done";

export interface SchedulerSettings {
  schedulerEnabled: boolean;
  /** UTC hour (0-23) after which the daily run starts. */
  runHourUtc: number;
  autoConfirm: boolean;
  state: ScheduleState;
  nextRunAt: string | null;
  checkEveryMinutes: number;
  lastScheduledRun: { id: string; runDate: string; status: RunStatus; startedAt: string; finishedAt: string | null; invoiced: number; failed: number } | null;
  updatedAt: string;
  updatedBy: string | null;
}

export const useSchedulerSettings = () =>
  useQuery({ queryKey: ["billing", "settings"], queryFn: () => get<{ settings: SchedulerSettings }>("/billing/settings").then((r) => r.settings) });

export function useUpdateSchedulerSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Partial<Pick<SchedulerSettings, "schedulerEnabled" | "runHourUtc" | "autoConfirm">>) =>
      patch<{ settings: SchedulerSettings }>("/billing/settings", v).then((r) => r.settings),
    onSuccess: (settings) => qc.setQueryData(["billing", "settings"], settings),
  });
}
