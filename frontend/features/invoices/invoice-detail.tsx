"use client";

import clsx from "clsx";
import { ArrowLeft, Mail, Printer } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/data/dialogs";
import { ErrorState, LoadingState, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Alert, Button, Card, Modal, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useCancelInvoice, useConfirmInvoice, useInvoice, useReissueInvoice, useSendInvoice } from "./api";
import { ACTION_LABEL, INVOICE_ERRORS, InvoiceStateBadge, PAYMENT_METHOD_LABEL } from "./labels";
import { printInvoice } from "./print";
import { RecordPaymentDialog } from "./record-payment-dialog";
import type { InvoiceAction, InvoiceDetail } from "./types";

/** Turn an API failure into a sentence a person can act on (used inside dialogs, which show thrown messages). */
const friendly = (err: unknown): Error => new Error(err instanceof ApiError ? (INVOICE_ERRORS[err.code] ?? err.message) : "Something went wrong. Please try again.");

/**
 * One invoice. Staff (`/invoices/:id`) and customers (`/my/invoices/:id`) share it: what each can do comes from the
 * API's `availableActions` (empty for customers), never from guessing the role here.
 */
export function InvoiceDetailView({ id, mode, backHref }: { id: string; mode: "staff" | "customer"; backHref: string }) {
  const query = useInvoice(id);
  if (query.isPending) return <LoadingState label="Loading invoice" />;
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Card>
        <ErrorState message={missing ? "We couldn't find that invoice." : "Could not load this invoice."} onRetry={missing ? undefined : () => void query.refetch()} />
        <p className="pb-6 text-center text-sm">
          <Link href={backHref} className="text-primary hover:underline">
            Back to invoices
          </Link>
        </p>
      </Card>
    );
  }
  return <Loaded inv={query.data} mode={mode} backHref={backHref} />;
}

type Dialog = "confirm" | "send" | "cancel" | "reissue" | "payment" | null;

function Loaded({ inv, mode, backHref }: { inv: InvoiceDetail; mode: "staff" | "customer"; backHref: string }) {
  const staff = mode === "staff";
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [printing, setPrinting] = useState(false);
  const confirm = useConfirmInvoice();
  const send = useSendInvoice();
  const reissue = useReissueInvoice();
  const can = (a: InvoiceAction) => inv.availableActions.includes(a);
  const hasDiscount = Number(inv.discountTotal) > 0;
  const a = inv.billTo.address;

  async function print() {
    setPrinting(true);
    try {
      await printInvoice(inv.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the invoice for printing");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <>
      <Link href={backHref} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {staff ? "Invoices" : "My invoices"}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{inv.number ?? "Draft invoice"}</h1>
            <InvoiceStateBadge state={inv.paymentState} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {staff && (
              <>
                <Link href={`/customers/${inv.customer.id}`} className="text-foreground hover:underline">
                  {inv.customer.name}
                </Link>
                {" · "}
              </>
            )}
            <Link href={staff ? `/subscriptions/${inv.subscription.id}` : `/my/subscriptions/${inv.subscription.id}`} className="hover:underline">
              {inv.subscription.number}
            </Link>
          </p>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Invoice actions">
          {can("confirm") && <Button onClick={() => setDialog("confirm")}>{ACTION_LABEL.confirm}</Button>}
          {can("record_payment") && <Button onClick={() => setDialog("payment")}>{ACTION_LABEL.record_payment}</Button>}
          {can("send") && (
            <Button variant="secondary" onClick={() => setDialog("send")}>
              <Mail className="size-4" aria-hidden /> {inv.sentAt ? "Resend" : "Send"}
            </Button>
          )}
          {can("reissue") && (
            <Button variant="secondary" onClick={() => setDialog("reissue")}>
              {ACTION_LABEL.reissue}
            </Button>
          )}
          <Button variant="secondary" onClick={() => void print()} loading={printing}>
            <Printer className="size-4" aria-hidden /> Print
          </Button>
          {can("cancel") && (
            <Button variant="danger" onClick={() => setDialog("cancel")}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {inv.daysOverdue > 0 && (
        <div className="mb-6">
          <Alert>
            This invoice is {inv.daysOverdue} {inv.daysOverdue === 1 ? "day" : "days"} overdue. {formatMoney(inv.balance)} is still owed (was due {formatDate(inv.dueDate)}).
          </Alert>
        </div>
      )}
      {inv.status === "CANCELLED" && (
        <div className="mb-6">
          <Alert>This invoice was cancelled{inv.cancelledAt && ` on ${formatDate(inv.cancelledAt)}`} and no longer counts toward what is owed.</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 font-semibold">Charges</h2>
            <TableWrap>
              <table className="w-full min-w-[600px] text-sm">
                <THead>
                  <tr>
                    <th className={thClass}>Description</th>
                    <th className={clsx(thClass, "text-right")}>Qty</th>
                    <th className={clsx(thClass, "text-right")}>Unit price</th>
                    {hasDiscount && <th className={clsx(thClass, "text-right")}>Discount</th>}
                    <th className={clsx(thClass, "text-right")}>Tax</th>
                    <th className={clsx(thClass, "text-right")}>Amount</th>
                  </tr>
                </THead>
                <tbody className="divide-y divide-border">
                  {inv.lines.map((l) => (
                    <tr key={l.id}>
                      <td className={tdClass}>{l.description}</td>
                      <td className={clsx(tdClass, "text-right tabular-nums")}>{l.quantity}</td>
                      <td className={clsx(tdClass, "text-right tabular-nums")}>{formatMoney(l.unitPrice)}</td>
                      {hasDiscount && <td className={clsx(tdClass, "text-right tabular-nums")}>{Number(l.discountAmount) ? `−${formatMoney(l.discountAmount)}` : "—"}</td>}
                      <td className={clsx(tdClass, "text-right tabular-nums")}>
                        {formatMoney(l.taxAmount)}
                        <p className="text-xs text-muted">{Number(l.taxRatePercent)}%</p>
                      </td>
                      <td className={clsx(tdClass, "text-right tabular-nums")}>{formatMoney(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>

            <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
              <Total label="Subtotal" value={formatMoney(inv.subtotal)} />
              {hasDiscount && (
                <>
                  {inv.discounts.map((d) => (
                    <Total key={d.id} label={`Discount: ${d.name}`} value={`−${formatMoney(d.amount)}`} muted />
                  ))}
                  {inv.discounts.length === 0 && <Total label="Discount" value={`−${formatMoney(inv.discountTotal)}`} />}
                </>
              )}
              <Total label="Tax" value={formatMoney(inv.taxTotal)} />
              <Total label="Total" value={formatMoney(inv.total)} strong rule />
              {Number(inv.amountPaid) > 0 && <Total label="Paid" value={`−${formatMoney(inv.amountPaid)}`} />}
              <Total label="Balance due" value={formatMoney(inv.balance)} strong />
            </dl>
          </Card>

          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Payments</h2>
              {can("record_payment") && (
                <Button size="sm" variant="secondary" onClick={() => setDialog("payment")}>
                  Record payment
                </Button>
              )}
            </div>
            {inv.payments.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">{inv.status === "DRAFT" ? "Confirm the invoice before payments can be recorded." : "No payments yet."}</p>
            ) : (
              <ul className="divide-y divide-border">
                {inv.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <div>
                      <p className="font-medium">
                        {PAYMENT_METHOD_LABEL[p.method]}
                        {p.reference && <span className="font-normal text-muted"> · {p.reference}</span>}
                      </p>
                      <p className="text-xs text-muted">
                        {formatDateTime(p.paidAt)}
                        {staff && p.recordedBy && ` · by ${p.recordedBy}`}
                      </p>
                      {staff && p.note && <p className="text-xs text-muted">{p.note}</p>}
                    </div>
                    <span className="font-semibold tabular-nums">{formatMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Details</h2>
            <dl className="space-y-3 text-sm">
              <Fact label="Issued" value={formatDate(inv.issueDate)} />
              <Fact label="Due" value={`${formatDate(inv.dueDate)}`} />
              <Fact label="Payment terms" value={inv.paymentTerm} />
              <Fact label="Period" value={`${formatDate(inv.periodStart)} – ${formatDate(inv.periodEnd)}`} />
              {inv.sentAt && <Fact label="Emailed" value={formatDate(inv.sentAt)} />}
              {inv.paidAt && <Fact label="Paid" value={formatDate(inv.paidAt)} />}
            </dl>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Billed to</h2>
            <p className="text-sm font-medium">{inv.billTo.name}</p>
            <address className="mt-1 text-sm not-italic leading-relaxed text-muted">
              {[a?.line1, a?.line2, [a?.city, a?.state, a?.postalCode].filter(Boolean).join(", "), a?.country].filter(Boolean).map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
              <span className="block">{inv.billTo.email}</span>
              {inv.billTo.taxId && <span className="block">Tax ID {inv.billTo.taxId}</span>}
            </address>
          </Card>
          {staff && inv.notes && (
            <Card className="p-5">
              <h2 className="mb-2 font-semibold">Internal notes</h2>
              <p className="whitespace-pre-wrap text-sm text-muted">{inv.notes}</p>
            </Card>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={dialog === "confirm"}
        title="Confirm this invoice?"
        confirmLabel="Confirm invoice"
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          const r = await confirm.mutateAsync(inv.id).catch((e) => Promise.reject(friendly(e)));
          toast.success(`Confirmed as ${r.invoice.number}`);
        }}
      >
        It gets its invoice number and can no longer be edited. After that you can email it and record payments. A zero-value invoice is marked paid automatically.
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "send"}
        title={inv.sentAt ? "Resend this invoice?" : "Email this invoice?"}
        confirmLabel="Send email"
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          await send.mutateAsync(inv.id).catch((e) => Promise.reject(friendly(e)));
          toast.success(`Sent to ${inv.billTo.email}`);
        }}
      >
        An email with the amount due and a link goes to <span className="font-medium text-foreground">{inv.billTo.email}</span>.
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "reissue"}
        title="Reissue this invoice?"
        confirmLabel="Create new draft"
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          const r = await reissue.mutateAsync(inv.id).catch((e) => Promise.reject(friendly(e)));
          toast.success("A new draft was created for the same period");
          router.push(`/invoices/${r.invoice.id}`);
        }}
      >
        A fresh draft is built for the same billing period from the subscription&apos;s <em>current</em> products, prices and discounts.
      </ConfirmDialog>

      <CancelDialog invoice={inv} open={dialog === "cancel"} onClose={() => setDialog(null)} />
      {can("record_payment") && <RecordPaymentDialog invoice={inv} open={dialog === "payment"} onClose={() => setDialog(null)} />}
    </>
  );
}

function CancelDialog({ invoice, open, onClose }: { invoice: InvoiceDetail; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Cancel this invoice?">
      <CancelForm invoice={invoice} onClose={onClose} />
    </Modal>
  );
}

function CancelForm({ invoice, onClose }: { invoice: InvoiceDetail; onClose: () => void }) {
  const cancel = useCancelInvoice();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await cancel.mutateAsync({ id: invoice.id, reason: reason.trim() });
      toast.success("Invoice cancelled");
      onClose();
    } catch (err) {
      setError(friendly(err).message);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-muted">
        The invoice stops counting toward what is owed, and any discount it used is given back. {invoice.status === "DRAFT" ? "" : "Its number is kept for the record."}
      </p>
      <Textarea label="Reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Wrong plan billed" rows={3} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Keep invoice
        </Button>
        <Button type="submit" variant="danger" loading={cancel.isPending} disabled={!reason.trim()}>
          Cancel invoice
        </Button>
      </div>
    </form>
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

function Total({ label, value, strong, rule, muted }: { label: string; value: string; strong?: boolean; rule?: boolean; muted?: boolean }) {
  return (
    <div className={clsx("flex justify-between gap-4", rule && "border-t border-border pt-1", strong && "text-base font-semibold")}>
      <dt className={clsx(!strong && "text-muted", muted && "text-xs")}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
