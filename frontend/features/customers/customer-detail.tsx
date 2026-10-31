"use client";

import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/data/dialogs";
import { ErrorState, LoadingState } from "@/components/data/list-parts";
import { Badge, Button, Card } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { CustomerSubscriptionsTable } from "../subscriptions/subscriptions-list";
import { STATUS_LABEL } from "../subscriptions/labels";
import { STATUSES } from "../subscriptions/types";
import { useCustomer, useDeleteCustomer } from "./api";
import { CustomerFormModal } from "./customer-form";
import type { CustomerDetail } from "./types";

export function CustomerDetailView({ id }: { id: string }) {
  const query = useCustomer(id);
  if (query.isPending) return <LoadingState label="Loading customer" />;
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Card>
        <ErrorState message={missing ? "We couldn't find that customer." : "Could not load this customer."} onRetry={missing ? undefined : () => void query.refetch()} />
        <p className="pb-6 text-center text-sm">
          <Link href="/customers" className="text-primary hover:underline">
            Back to customers
          </Link>
        </p>
      </Card>
    );
  }
  return <Loaded customer={query.data} />;
}

function Loaded({ customer: c }: { customer: CustomerDetail }) {
  const router = useRouter();
  const { user } = useAuth();
  const remove = useDeleteCustomer();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const overdue = Number(c.overdueBalance) > 0;
  const a = c.billingAddress;

  return (
    <>
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Customers
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <p className="mt-1 text-sm text-muted">{[c.companyName, c.email].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/subscriptions/new?customerId=${c.id}`}>
            <Button>
              <Plus className="size-4" aria-hidden /> New subscription
            </Button>
          </Link>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden /> Edit
          </Button>
          {user?.role === "ADMIN" && (
            <Button variant="ghost" onClick={() => setDeleting(true)} aria-label="Delete customer">
              <Trash2 className="size-4 text-danger" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-muted">Outstanding</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(c.outstandingBalance)}</p>
          <p className="text-xs text-muted">Invoiced and not yet paid</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-muted">Overdue</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${overdue ? "text-danger" : ""}`}>{formatMoney(c.overdueBalance)}</p>
          <p className="text-xs text-muted">{overdue ? "Past the due date: chase this" : "Nothing late"}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-muted">Subscriptions</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {STATUSES.filter((s) => c.subscriptionsByStatus[s]).map((s) => (
              <Badge key={s} tone={s === "ACTIVE" ? "success" : "neutral"}>
                {c.subscriptionsByStatus[s]} {STATUS_LABEL[s].toLowerCase()}
              </Badge>
            ))}
            {Object.keys(c.subscriptionsByStatus).length === 0 && <span className="text-sm text-muted">None yet</span>}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="overflow-hidden">
          <h2 className="border-b border-border px-5 py-4 font-semibold">Subscriptions</h2>
          <CustomerSubscriptionsTable customerId={c.id} />
        </Card>

        <aside className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Contact</h2>
            <dl className="space-y-3 text-sm">
              <Row label="Email" value={c.email} />
              <Row label="Phone" value={c.phone} />
              <Row label="Tax ID" value={c.taxId} />
              <Row label="Portal" value={c.hasPortalAccess ? "Has a login" : "No login yet"} />
              <Row label="Added" value={formatDate(c.createdAt)} />
            </dl>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Billing address</h2>
            {a ? (
              <address className="text-sm not-italic leading-relaxed text-muted">
                {a.line1}
                <br />
                {a.line2 && (
                  <>
                    {a.line2}
                    <br />
                  </>
                )}
                {[a.city, a.state, a.postalCode].filter(Boolean).join(", ")}
                <br />
                {a.country}
              </address>
            ) : (
              <p className="text-sm text-muted">Not provided.</p>
            )}
          </Card>
          {c.notes && (
            <Card className="p-5">
              <h2 className="mb-2 font-semibold">Internal notes</h2>
              <p className="whitespace-pre-wrap text-sm text-muted">{c.notes}</p>
            </Card>
          )}
        </aside>
      </div>

      <CustomerFormModal open={editing} onClose={() => setEditing(false)} customer={c} />

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${c.name}?`}
        confirmLabel="Delete customer"
        danger
        onConfirm={async () => {
          try {
            await remove.mutateAsync(c.id);
          } catch (err) {
            // The API refuses while subscriptions or invoices are still open: say exactly why.
            if (err instanceof ApiError && err.code === "CONFLICT") {
              const d = err.details as { openSubscriptions?: number; openInvoices?: number } | undefined;
              throw new Error(`Can't delete yet: ${d?.openSubscriptions ?? 0} open subscription(s) and ${d?.openInvoices ?? 0} unsettled invoice(s). Close or settle them first.`);
            }
            throw err;
          }
          toast.success("Customer deleted");
          router.replace("/customers");
        }}
      >
        They will no longer appear in lists, and their portal login (if any) is switched off.
      </ConfirmDialog>
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="break-all text-right font-medium">{value || <span className="text-muted">—</span>}</dd>
    </div>
  );
}
