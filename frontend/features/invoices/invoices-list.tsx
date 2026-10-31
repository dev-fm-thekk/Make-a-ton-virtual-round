"use client";

import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState, Pagination, SearchInput, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Alert, Button, Card, PageHeader } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { useUrlParams } from "@/lib/hooks";
import { useBulkConfirm, useInvoices } from "./api";
import { InvoiceStateBadge } from "./labels";
import type { InvoiceListParams } from "./types";

type View = "all" | "draft" | "unpaid" | "overdue" | "paid" | "cancelled";

const STAFF_VIEWS: { id: View; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "unpaid", label: "Awaiting payment" },
  { id: "overdue", label: "Overdue" },
  { id: "paid", label: "Paid" },
  { id: "cancelled", label: "Cancelled" },
];
const CUSTOMER_VIEWS = STAFF_VIEWS.filter((v) => ["all", "unpaid", "overdue", "paid"].includes(v.id));

/** A view is just a named filter on the API's status / overdue parameters. */
const VIEW_PARAMS: Record<View, Pick<InvoiceListParams, "status" | "overdue">> = {
  all: {},
  draft: { status: "DRAFT" },
  unpaid: { status: "CONFIRMED" },
  overdue: { overdue: "true" },
  paid: { status: "PAID" },
  cancelled: { status: "CANCELLED" },
};

const DEFAULTS = { view: "all", search: "", customerId: "", run: "", sort: "-issueDate", page: "1" };

export function InvoicesList({ mode, basePath }: { mode: "staff" | "customer"; basePath: string }) {
  const staff = mode === "staff";
  const [q, setQ] = useUrlParams(DEFAULTS);
  const view = (STAFF_VIEWS.some((v) => v.id === q.view) ? q.view : "all") as View;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const bulk = useBulkConfirm();

  const query = useInvoices({ page: Number(q.page), ...VIEW_PARAMS[view], search: q.search, sort: q.sort, ...(staff && { customerId: q.customerId, billingRunId: q.run }) });
  const data = query.data;
  const drafts = useMemo(() => (data?.items ?? []).filter((i) => i.status === "DRAFT"), [data]);
  const allDraftsSelected = drafts.length > 0 && drafts.every((d) => selected.has(d.id));
  const filtered = !!(q.search || q.customerId || q.run || view !== "all");

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function confirmBulk(input: { ids?: string[]; billingRunId?: string }) {
    try {
      const r = await bulk.mutateAsync(input);
      setSelected(new Set());
      if (r.failed.length) toast.warning(`${r.confirmed} confirmed, ${r.failed.length} could not be: ${r.failed[0]?.error}`);
      else toast.success(`${r.confirmed} invoice${r.confirmed === 1 ? "" : "s"} confirmed${r.more ? ". More drafts remain: run it again." : ""}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not confirm the invoices");
    }
  }

  return (
    <>
      <PageHeader
        title={staff ? "Invoices" : "My invoices"}
        description={staff ? "Review drafts, confirm and send them, and keep an eye on what is unpaid." : "What you've been billed and what is still due."}
        actions={
          staff && (
            <Link href="/billing">
              <Button variant="secondary">Billing runs</Button>
            </Link>
          )
        }
      />

      {staff && (q.run || q.customerId) && (
        <div className="mb-4">
          <Alert tone="success">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>{q.run ? "Showing invoices from one billing run." : "Showing one customer's invoices."}</span>
              <button className="underline" onClick={() => setQ({ run: "", customerId: "" })}>
                Show all invoices
              </button>
            </span>
          </Alert>
        </div>
      )}

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <SearchInput value={q.search} onChange={(search) => setQ({ search })} placeholder={staff ? "Search invoice number or customer" : "Search invoice number"} label="Search invoices" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter invoices">
          {(staff ? STAFF_VIEWS : CUSTOMER_VIEWS).map((v) => (
            <button
              key={v.id}
              aria-pressed={view === v.id}
              onClick={() => {
                setSelected(new Set());
                setQ({ view: v.id });
              }}
              className={clsx("rounded-full border px-3 py-1 text-sm transition-colors", view === v.id ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted hover:text-foreground")}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {data && data.totals.invoices > 0 && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <SummaryCard label={`${data.totals.invoices} invoice${data.totals.invoices === 1 ? "" : "s"}`} value={formatMoney(data.totals.total)} />
          <SummaryCard label="Paid so far" value={formatMoney(data.totals.paid)} />
          <SummaryCard label="Still owed" value={formatMoney(data.totals.balance)} danger={view === "overdue" && Number(data.totals.balance) > 0} />
        </div>
      )}

      {staff && (selected.size > 0 || (view === "draft" && q.run && drafts.length > 0)) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm" role="region" aria-label="Bulk actions">
          {selected.size > 0 ? (
            <>
              <span className="font-medium">{selected.size} selected</span>
              <Button size="sm" loading={bulk.isPending} onClick={() => void confirmBulk({ ids: [...selected] })}>
                Confirm selected
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </>
          ) : (
            <>
              <span>Every draft from this billing run is ready for review.</span>
              <Button size="sm" loading={bulk.isPending} onClick={() => void confirmBulk({ billingRunId: q.run })}>
                Confirm all drafts from this run
              </Button>
            </>
          )}
        </div>
      )}

      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState label="Loading invoices" />
        ) : query.isError ? (
          <ErrorState message="Could not load invoices." onRetry={() => void query.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState title={filtered ? "No invoices match" : staff ? "No invoices yet" : "No invoices yet"} hint={filtered ? "Try a different filter." : staff ? "They appear after a billing run." : "Your invoices will appear here once you've been billed."} action={staff && !filtered && <Link href="/billing"><Button size="sm">Go to billing</Button></Link>} />
        ) : (
          <TableWrap dimmed={query.isPlaceholderData}>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  {staff && (
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all drafts on this page"
                        disabled={drafts.length === 0}
                        checked={allDraftsSelected}
                        onChange={() => setSelected(allDraftsSelected ? new Set() : new Set(drafts.map((d) => d.id)))}
                      />
                    </th>
                  )}
                  <th className={thClass}>Invoice</th>
                  {staff && <th className={thClass}>Customer</th>}
                  <th className={thClass}>Issued</th>
                  <th className={thClass}>Due</th>
                  <th className={thClass}>Status</th>
                  <th className={clsx(thClass, "text-right")}>Total</th>
                  <th className={clsx(thClass, "text-right")}>Balance</th>
                </tr>
              </THead>
              <tbody className="divide-y divide-border">
                {data?.items.map((i) => (
                  <tr key={i.id} className="hover:bg-surface-2/60">
                    {staff && (
                      <td className="px-4 py-3">
                        {i.status === "DRAFT" && <input type="checkbox" aria-label={`Select draft for ${i.customer.name}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} />}
                      </td>
                    )}
                    <td className={tdClass}>
                      <Link href={`${basePath}/${i.id}`} className="font-medium text-primary hover:underline">
                        {i.number ?? "Draft"}
                      </Link>
                      <p className="text-xs text-muted">{i.subscription.number}</p>
                    </td>
                    {staff && (
                      <td className={tdClass}>
                        <Link href={`/customers/${i.customer.id}`} className="hover:underline">
                          {i.customer.name}
                        </Link>
                        {i.customer.companyName && <p className="text-xs text-muted">{i.customer.companyName}</p>}
                      </td>
                    )}
                    <td className={tdClass}>{formatDate(i.issueDate)}</td>
                    <td className={tdClass}>{formatDate(i.dueDate)}</td>
                    <td className={tdClass}>
                      <InvoiceStateBadge state={i.paymentState} />
                    </td>
                    <td className={clsx(tdClass, "text-right tabular-nums")}>{formatMoney(i.total)}</td>
                    <td className={clsx(tdClass, "text-right font-medium tabular-nums")}>{formatMoney(i.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} noun="invoices" onPage={(p) => setQ({ page: String(p) }, { resetPage: false })} />}
      </Card>
    </>
  );
}

function SummaryCard({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={clsx("mt-1 text-xl font-semibold tabular-nums", danger && "text-danger")}>{value}</p>
    </Card>
  );
}

/** Recent invoices for one subscription (shown on the subscription page). */
export function SubscriptionInvoices({ subscriptionId, mode }: { subscriptionId: string; mode: "staff" | "customer" }) {
  const staff = mode === "staff";
  const base = staff ? "/invoices" : "/my/invoices";
  const query = useInvoices({ subscriptionId, limit: 5, sort: "-issueDate" });
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 className="font-semibold">Invoices</h2>
        {query.data && query.data.total > 5 && <span className="text-xs text-muted">Latest 5 of {query.data.total}</span>}
      </div>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} message="Could not load invoices." />
      ) : query.data.items.length === 0 ? (
        <p className="px-6 py-6 text-center text-sm text-muted">No invoices yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {query.data.items.map((i) => (
            <li key={i.id}>
              <Link href={`${base}/${i.id}`} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm hover:bg-surface-2/60">
                <span>
                  <span className="font-medium text-primary">{i.number ?? "Draft"}</span>
                  <span className="block text-xs text-muted">
                    {formatDate(i.periodStart)} – {formatDate(i.periodEnd)}
                  </span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="tabular-nums">{formatMoney(i.total)}</span>
                  <InvoiceStateBadge state={i.paymentState} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
