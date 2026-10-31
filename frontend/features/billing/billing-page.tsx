"use client";

import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarClock, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState, Pagination, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Alert, Badge, Button, Card, Input, Modal, PageHeader } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatMoney, plural, todayIso } from "@/lib/format";
import { useRun, useRuns, usePreview, useStartRun, type BillingRun, type RunStatus } from "./api";

const STATUS: Record<RunStatus, { label: string; tone: "primary" | "success" | "warning" | "danger" }> = {
  RUNNING: { label: "Running", tone: "primary" },
  COMPLETED: { label: "Completed", tone: "success" },
  PARTIAL: { label: "Needs attention", tone: "warning" },
  FAILED: { label: "Failed", tone: "danger" },
};
const RunBadge = ({ status }: { status: RunStatus }) => <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;

export function BillingPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const preview = usePreview();
  const [page, setPage] = useState(1);
  const [starting, setStarting] = useState(false);
  const [watching, setWatching] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const runs = useRuns(page, true);
  const p = preview.data;

  return (
    <>
      <PageHeader title="Billing" description="Turn due subscriptions into invoices. This also runs automatically every day when the scheduler is on." />

      <Card className="mb-6 p-6">
        {preview.isPending ? (
          <LoadingState />
        ) : preview.isError ? (
          <ErrorState message="Could not check what is due." onRetry={() => void preview.refetch()} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <CalendarClock className="size-6" aria-hidden />
              </span>
              <div>
                {p!.dueSubscriptions === 0 ? (
                  <>
                    <p className="text-lg font-semibold">Nothing is due for billing</p>
                    <p className="text-sm text-muted">Every active subscription is up to date as of {formatDate(p!.asOf)}.</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold">{plural(p!.dueSubscriptions, "subscription")} due for billing</p>
                    <p className="text-sm text-muted">
                      About <span className="font-medium text-foreground">{formatMoney(p!.estimatedTotal)}</span> before discounts
                      {p!.oldestDue && <> · oldest due {formatDate(p!.oldestDue)}</>}
                    </p>
                  </>
                )}
              </div>
            </div>
            {isAdmin ? (
              <Button onClick={() => setStarting(true)} disabled={p!.dueSubscriptions === 0}>
                <Play className="size-4" aria-hidden /> Run billing
              </Button>
            ) : (
              <p className="text-sm text-muted">Only an admin can start a billing run.</p>
            )}
          </div>
        )}
      </Card>

      {watching && <LiveRun id={watching} onOpen={() => setOpenRun(watching)} onDismiss={() => setWatching(null)} />}

      <Card className="overflow-hidden">
        <h2 className="border-b border-border px-6 py-4 font-semibold">Run history</h2>
        {runs.isPending ? (
          <LoadingState />
        ) : runs.isError ? (
          <ErrorState message="Could not load billing runs." onRetry={() => void runs.refetch()} />
        ) : runs.data.items.length === 0 ? (
          <EmptyState title="No billing runs yet" hint="Press Run billing once subscriptions are due, or turn on the daily scheduler." />
        ) : (
          <TableWrap dimmed={runs.isPlaceholderData}>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Started</th>
                  <th className={thClass}>Trigger</th>
                  <th className={thClass}>Status</th>
                  <th className={clsx(thClass, "text-right")}>Invoiced</th>
                  <th className={clsx(thClass, "text-right")}>Skipped</th>
                  <th className={clsx(thClass, "text-right")}>Failed</th>
                  <th className={thClass} />
                </tr>
              </THead>
              <tbody className="divide-y divide-border">
                {runs.data.items.map((r) => (
                  <RunRow key={r.id} run={r} onOpen={() => setOpenRun(r.id)} />
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {runs.data && <Pagination page={runs.data.page} totalPages={runs.data.totalPages} total={runs.data.total} noun="runs" onPage={setPage} />}
      </Card>

      <StartRunDialog
        open={starting}
        due={p?.dueSubscriptions ?? 0}
        onClose={() => setStarting(false)}
        onStarted={(id) => {
          setStarting(false);
          setWatching(id);
        }}
      />
      <RunDetailDialog id={openRun} onClose={() => setOpenRun(null)} />
    </>
  );
}

function RunRow({ run: r, onOpen }: { run: BillingRun; onOpen: () => void }) {
  return (
    <tr className="cursor-pointer hover:bg-surface-2/60" onClick={onOpen}>
      <td className={tdClass}>
        {formatDateTime(r.startedAt)}
        <p className="text-xs text-muted">Billing date {formatDate(r.runDate)}</p>
      </td>
      <td className={tdClass}>{r.triggeredBy === "scheduler" ? "Scheduled" : "Manual"}</td>
      <td className={tdClass}>
        <RunBadge status={r.status} />
      </td>
      <td className={clsx(tdClass, "text-right tabular-nums")}>
        {r.invoiced}
        <span className="text-muted"> / {r.scanned}</span>
      </td>
      <td className={clsx(tdClass, "text-right tabular-nums")}>{r.skipped}</td>
      <td className={clsx(tdClass, "text-right tabular-nums", r.failed > 0 && "font-medium text-danger")}>{r.failed}</td>
      <td className={clsx(tdClass, "text-right")}>
        <button className="text-primary hover:underline" onClick={onOpen}>
          Details
        </button>
      </td>
    </tr>
  );
}

// ───────── a run that is happening right now ─────────

function LiveRun({ id, onOpen, onDismiss }: { id: string; onOpen: () => void; onDismiss: () => void }) {
  const run = useRun(id);
  const qc = useQueryClient();
  const announced = useRef(false);
  const r = run.data;

  // When the run finishes: tell the person once and refresh everything that depends on invoices.
  useEffect(() => {
    if (!r || r.status === "RUNNING" || announced.current) return;
    announced.current = true;
    void qc.invalidateQueries({ queryKey: ["billing"] }); // history table + "what is due" card
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ["reports"] });
    if (r.status === "COMPLETED") toast.success(`Billing finished: ${plural(r.invoiced, "invoice")} created`);
    else toast.warning(r.status === "PARTIAL" ? `Billing finished with ${r.failed} problem${r.failed === 1 ? "" : "s"}` : "Billing run failed");
  }, [r, qc]);

  if (!r) return null;
  const running = r.status === "RUNNING";
  return (
    <div role="status" aria-live="polite" className="mb-6">
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <RunBadge status={r.status} />
          <span className="text-sm">
            {running ? "Billing in progress: " : "Finished: "}
            <span className="font-medium">{plural(r.invoiced, "invoice")}</span> created
            {r.skipped > 0 && `, ${r.skipped} skipped`}
            {r.failed > 0 && <span className="text-danger">, {r.failed} failed</span>}
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onOpen}>
            Details
          </Button>
          {!running && (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      </div>
      {running && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        </div>
      )}
    </Card>
    </div>
  );
}

// ───────── start a run ─────────

function StartRunDialog({ open, due, onClose, onStarted }: { open: boolean; due: number; onClose: () => void; onStarted: (id: string) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Run billing">
      <StartRunForm due={due} onClose={onClose} onStarted={onStarted} />
    </Modal>
  );
}

function StartRunForm({ due, onClose, onStarted }: { due: number; onClose: () => void; onStarted: (id: string) => void }) {
  const start = useStartRun();
  const [asOf, setAsOf] = useState(todayIso());
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const run = await start.mutateAsync({ ...(asOf !== todayIso() && { asOf }), autoConfirm });
      toast.info("Billing started");
      onStarted(run.id);
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === "RUN_IN_PROGRESS" ? "Another billing run is already in progress. Wait for it to finish." : err.message) : "Could not start billing.");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-muted">
        Creates an invoice for every subscription that is due ({due} right now). It is safe to run more than once: nothing is ever billed twice, and subscriptions already billed are skipped.
      </p>
      <Input label="Bill everything due up to" type="date" max={todayIso()} value={asOf} onChange={(e) => setAsOf(e.target.value)} hint="Invoices are issued on this date. It can't be in the future." />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1" checked={autoConfirm} onChange={(e) => setAutoConfirm(e.target.checked)} />
        <span>
          <span className="font-medium">Confirm the invoices straight away</span>
          <span className="block text-muted">Leave unticked to review them as drafts first (recommended).</span>
        </span>
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={start.isPending} disabled={!asOf}>
          Start billing
        </Button>
      </div>
    </form>
  );
}

// ───────── one run in detail ─────────

function RunDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Modal open={id !== null} onClose={onClose} title="Billing run" wide>
      {id && <RunDetail id={id} />}
    </Modal>
  );
}

function RunDetail({ id }: { id: string }) {
  const run = useRun(id);
  if (run.isPending) return <LoadingState />;
  if (run.isError) return <ErrorState onRetry={() => void run.refetch()} message="Could not load this run." />;
  const r = run.data;
  const drafts = r.invoiced - r.confirmed;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <RunBadge status={r.status} />
        <span className="text-sm text-muted">
          Started {formatDateTime(r.startedAt)}
          {r.finishedAt && ` · finished ${formatDateTime(r.finishedAt)}`}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Invoices created" value={String(r.invoiced)} />
        <Stat label="Total invoiced" value={formatMoney(r.invoicedTotal)} />
        <Stat label="Skipped" value={String(r.skipped)} />
        <Stat label="Failed" value={String(r.failed)} danger={r.failed > 0} />
      </dl>

      {r.invoiced > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-4 py-3 text-sm">
          <span>
            {r.confirmed} confirmed · {drafts} draft{drafts === 1 ? "" : "s"}
          </span>
          {drafts > 0 && (
            <Link href={`/invoices?view=draft&run=${r.id}`} className="font-medium text-primary hover:underline">
              Review &amp; confirm the drafts →
            </Link>
          )}
          <Link href={`/invoices?run=${r.id}`} className="text-primary hover:underline">
            View all invoices from this run
          </Link>
        </div>
      )}

      {r.errors && r.errors.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Needs attention</h3>
          <p className="mb-2 text-sm text-muted">These subscriptions were not billed and stay due. Fix the problem and run billing again.</p>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {r.errors.map((e, i) => (
              <li key={`${e.subscriptionId}-${i}`} className="px-3 py-2">
                {e.subscriptionId ? (
                  <Link href={`/subscriptions/${e.subscriptionId}`} className="font-medium text-primary hover:underline">
                    {e.subscription}
                  </Link>
                ) : (
                  <span className="font-medium">{e.subscription}</span>
                )}
                <p className="text-muted">{e.error}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={clsx("mt-0.5 text-lg font-semibold tabular-nums", danger && "text-danger")}>{value}</dd>
    </div>
  );
}
