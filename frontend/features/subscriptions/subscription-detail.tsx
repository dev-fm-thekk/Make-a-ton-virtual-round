"use client";

import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState, LoadingState, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, todayIso } from "@/lib/format";
import { subscriptionKeys, useFormOptions, useReplaceLines, useSubscription } from "./api";
import { ActionDialog } from "./action-dialog";
import { DetailsModal } from "./details-modal";
import { SubscriptionInvoices } from "../invoices/invoices-list";
import { ACTION_ORDER, ACTIONS, billingCycle, ERROR_HINTS, STATUS_LABEL, StatusBadge } from "./labels";
import { LinesEditor } from "./lines-editor";
import { fromSavedLines, lineProblem, toPayload } from "./preview";
import { blockedReason, isEditable } from "./rules";
import type { DraftLine, SubscriptionAction, SubscriptionDetail } from "./types";

/**
 * One subscription. Used by staff (`/subscriptions/:id`) and by customers (`/my/subscriptions/:id`):
 * what each person may do comes from the API (`availableActions`), never from guessing the role here.
 */
export function SubscriptionDetailView({ id, mode, backHref }: { id: string; mode: "staff" | "customer"; backHref: string }) {
  const query = useSubscription(id);

  if (query.isPending) return <LoadingState label="Loading subscription" />;
  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Card>
        <ErrorState message={notFound ? "We couldn't find that subscription." : "Could not load this subscription."} onRetry={notFound ? undefined : () => void query.refetch()} />
        <p className="pb-6 text-center text-sm">
          <Link href={backHref} className="text-primary hover:underline">
            Back to subscriptions
          </Link>
        </p>
      </Card>
    );
  }
  return <Loaded sub={query.data} mode={mode} backHref={backHref} />;
}

function Loaded({ sub, mode, backHref }: { sub: SubscriptionDetail; mode: "staff" | "customer"; backHref: string }) {
  const staff = mode === "staff";
  const today = todayIso();
  const [action, setAction] = useState<SubscriptionAction | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const editable = staff && isEditable(sub.status);
  const actions = ACTION_ORDER.filter((a) => sub.availableActions.includes(a));

  return (
    <>
      <Link href={backHref} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {staff ? "Subscriptions" : "My subscriptions"}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{sub.number}</h1>
            <StatusBadge status={sub.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {staff && (
              <>
                <Link href={`/customers/${sub.customer.id}`} className="text-foreground hover:underline">
                  {sub.customer.name}
                </Link>
                {" · "}
              </>
            )}
            {sub.plan.name} · {billingCycle(sub.plan)}
          </p>
        </div>

        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Subscription actions">
            {actions.map((a) => {
              const blocked = blockedReason(a, sub, today);
              return (
                <Button key={a} variant={ACTIONS[a].variant} disabled={!!blocked} title={blocked ?? undefined} onClick={() => setAction(a)}>
                  {ACTIONS[a].label}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {sub.status === "QUOTATION" && sub.quoteValidUntil && (
        <div className="mb-6">
          <Alert tone={sub.quoteValidUntil < today ? "danger" : "success"}>
            {sub.quoteValidUntil < today ? `This quotation expired on ${formatDate(sub.quoteValidUntil)}.` : `This quotation is valid until ${formatDate(sub.quoteValidUntil)}.`}
          </Alert>
        </div>
      )}
      {sub.status === "CLOSED" && sub.closeReason && (
        <div className="mb-6">
          <Alert>
            Closed {sub.closedAt && `on ${formatDate(sub.closedAt)}`} — {sub.closeReason}
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <LinesPanel sub={sub} editable={editable} />
          {(sub.activatedAt || sub.status === "ACTIVE" || sub.status === "PAUSED" || sub.status === "CLOSED") && <SubscriptionInvoices subscriptionId={sub.id} mode={mode} />}
          {sub.history.length > 0 && <History sub={sub} showActor={staff} />}
        </div>

        <aside className="space-y-6">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Details</h2>
              {editable && (
                <Button size="sm" variant="ghost" onClick={() => setEditingDetails(true)}>
                  <Pencil className="size-3.5" aria-hidden /> Edit
                </Button>
              )}
            </div>
            <dl className="space-y-3 text-sm">
              <Fact label="Start date" value={formatDate(sub.startDate)} />
              <Fact label="Expiry date" value={sub.expiryDate ? formatDate(sub.expiryDate) : "No expiry"} />
              <Fact label="Next invoice" value={sub.status === "ACTIVE" ? formatDate(sub.nextBillingDate) : sub.status === "PAUSED" ? "Paused" : "—"} />
              <Fact label="Payment terms" value={`${sub.paymentTerm.name}${sub.paymentTerm.dueDays ? ` (${sub.paymentTerm.dueDays} days)` : ""}`} />
              <Fact label="Billing" value={billingCycle(sub.plan)} />
              {sub.plan.minQuantity > 1 && <Fact label="Minimum quantity" value={String(sub.plan.minQuantity)} />}
              {sub.activatedAt && <Fact label="Activated" value={formatDate(sub.activatedAt)} />}
            </dl>
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-4">
              <Badge tone={sub.plan.allowPause ? "success" : "neutral"}>{sub.plan.allowPause ? "Can pause" : "No pause"}</Badge>
              <Badge tone={sub.plan.allowEarlyClose ? "success" : "neutral"}>{sub.plan.allowEarlyClose ? "Early close" : "No early close"}</Badge>
              <Badge tone={sub.plan.allowRenewal ? "success" : "neutral"}>{sub.plan.allowRenewal ? "Renewable" : "Not renewable"}</Badge>
            </div>
          </Card>

          {staff && sub.notes && (
            <Card className="p-5">
              <h2 className="mb-2 font-semibold">Internal notes</h2>
              <p className="whitespace-pre-wrap text-sm text-muted">{sub.notes}</p>
            </Card>
          )}
        </aside>
      </div>

      <ActionDialog subscription={sub} action={action} onClose={() => setAction(null)} />
      {editable && <DetailsModal subscription={sub} open={editingDetails} onClose={() => setEditingDetails(false)} />}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

// ───────── lines: read-only table, or the editor while the deal is still being shaped ─────────

function LinesPanel({ sub, editable }: { sub: SubscriptionDetail; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Products</h2>
          <p className="text-sm text-muted">Billed {billingCycle(sub.plan).toLowerCase()}.</p>
        </div>
        {editable && !editing && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" aria-hidden /> Edit lines
          </Button>
        )}
      </div>
      {editing ? <LinesEditorPanel sub={sub} onDone={() => setEditing(false)} /> : <ReadOnlyLines sub={sub} />}
    </Card>
  );
}

function ReadOnlyLines({ sub }: { sub: SubscriptionDetail }) {
  if (sub.lines.length === 0) return <p className="py-6 text-center text-sm text-muted">No products on this subscription yet.</p>;
  return (
    <>
      <TableWrap>
        <table className="w-full min-w-[560px] text-sm">
          <THead>
            <tr>
              <th className={thClass}>Product</th>
              <th className={clsx(thClass, "text-right")}>Qty</th>
              <th className={clsx(thClass, "text-right")}>Unit price</th>
              <th className={clsx(thClass, "text-right")}>Tax</th>
              <th className={clsx(thClass, "text-right")}>Amount</th>
            </tr>
          </THead>
          <tbody className="divide-y divide-border">
            {sub.lines.map((l) => (
              <tr key={l.id}>
                <td className={tdClass}>
                  <p className="font-medium">{l.productName}</p>
                  {l.variantLabel && <p className="text-xs text-muted">{l.variantLabel}</p>}
                </td>
                <td className={clsx(tdClass, "text-right tabular-nums")}>{l.quantity}</td>
                <td className={clsx(tdClass, "text-right tabular-nums")}>{formatMoney(l.unitPrice)}</td>
                <td className={clsx(tdClass, "text-right tabular-nums")}>
                  {l.taxName ? (
                    <>
                      {formatMoney(l.taxAmount)}
                      <p className="text-xs text-muted">
                        {l.taxName} {Number(l.taxRatePercent)}%
                      </p>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className={clsx(tdClass, "text-right tabular-nums")}>{formatMoney(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Subtotal</dt>
          <dd className="tabular-nums">{formatMoney(sub.totals.untaxed)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Tax</dt>
          <dd className="tabular-nums">{formatMoney(sub.totals.tax)}</dd>
        </div>
        <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
          <dt>Total per period</dt>
          <dd className="tabular-nums">{formatMoney(sub.totals.total)}</dd>
        </div>
      </dl>
    </>
  );
}

function LinesEditorPanel({ sub, onDone }: { sub: SubscriptionDetail; onDone: () => void }) {
  const options = useFormOptions();
  const replace = useReplaceLines(sub.id);
  const qc = useQueryClient();
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (options.isPending) return <LoadingState />;
  if (options.isError) return <ErrorState message="Could not load the catalog." onRetry={() => void options.refetch()} />;
  const draft = lines ?? fromSavedLines(sub.lines, options.data);

  async function save() {
    setShowErrors(true);
    setError(null);
    if (draft.length === 0) return setError("Keep at least one product line.");
    if (draft.some((l) => lineProblem(l))) return;
    try {
      await replace.mutateAsync({ version: sub.version, lines: draft.map(toPayload) });
      toast.success("Products updated");
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "STALE_VERSION") {
        void qc.invalidateQueries({ queryKey: subscriptionKeys.detail(sub.id) });
        toast.warning(ERROR_HINTS.STALE_VERSION);
        onDone();
        return;
      }
      setError(err instanceof ApiError ? (ERROR_HINTS[err.code] ?? err.message) : "Could not save. Try again.");
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <LinesEditor options={options.data} lines={draft} onChange={setLines} showErrors={showErrors} disabled={replace.isPending} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={replace.isPending}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={replace.isPending}>
          Save products
        </Button>
      </div>
    </div>
  );
}

// ───────── history ─────────

function History({ sub, showActor }: { sub: SubscriptionDetail; showActor: boolean }) {
  // newest first
  const entries = [...sub.history].reverse();
  return (
    <Card className="p-6">
      <h2 className="mb-4 font-semibold">History</h2>
      <ol className="space-y-4">
        {entries.map((h, i) => (
          <li key={`${h.at}-${i}`} className="flex gap-3">
            <span className={clsx("mt-1.5 size-2.5 shrink-0 rounded-full", i === 0 ? "bg-primary" : "bg-border")} aria-hidden />
            <div className="min-w-0 text-sm">
              <p className="font-medium">{h.from ? `${STATUS_LABEL[h.from]} → ${STATUS_LABEL[h.to]}` : `Created as ${STATUS_LABEL[h.to]}`}</p>
              {h.reason && <p className="text-muted">{h.reason}</p>}
              <p className="text-xs text-muted">
                {formatDateTime(h.at)}
                {showActor && h.by && ` · ${h.by}`}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
