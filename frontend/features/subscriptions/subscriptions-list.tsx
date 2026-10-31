"use client";

import clsx from "clsx";
import { Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState, ErrorState, LoadingState, Pagination, SearchInput, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Button, Card, PageHeader } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { useUrlParams } from "@/lib/hooks";
import { useSubscriptions } from "./api";
import { billingCycle, STATUS_LABEL, StatusBadge } from "./labels";
import { STATUSES } from "./types";

const DEFAULTS = { status: "", search: "", sort: "-createdAt", page: "1" };

/**
 * Subscriptions table. `mode="staff"` shows every customer and the create button;
 * `mode="customer"` is the portal view (the API already scopes rows to the signed-in customer).
 */
export function SubscriptionsList({ mode, basePath, customerId }: { mode: "staff" | "customer"; basePath: string; customerId?: string }) {
  const staff = mode === "staff";
  const [q, setQ] = useUrlParams(DEFAULTS);
  const query = useSubscriptions({ page: Number(q.page), status: q.status, search: q.search, sort: q.sort, customerId });
  const data = query.data;

  return (
    <>
      <PageHeader
        title={staff ? "Subscriptions" : "My subscriptions"}
        description={staff ? "Every subscription, from draft to closed." : "Your plans, renewals and what you pay each period."}
        actions={
          staff && (
            <Link href={`${basePath}/new`}>
              <Button>
                <Plus className="size-4" aria-hidden /> New subscription
              </Button>
            </Link>
          )
        }
      />

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <SearchInput value={q.search} onChange={(search) => setQ({ search })} placeholder={staff ? "Search number or customer" : "Search by number"} label="Search subscriptions" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {[{ value: "", label: "All" }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))].map((o) => (
            <button
              key={o.value}
              aria-pressed={q.status === o.value}
              onClick={() => setQ({ status: o.value })}
              className={clsx(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                q.status === o.value ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState label="Loading subscriptions" />
        ) : query.isError ? (
          <ErrorState message="Could not load subscriptions." onRetry={() => void query.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title={q.search || q.status ? "No subscriptions match your filters" : staff ? "No subscriptions yet" : "You have no subscriptions yet"}
            hint={staff ? "Create one from a quotation template or from scratch." : "When a subscription is set up for you, it will show here."}
            action={staff && !q.search && !q.status ? <Link href={`${basePath}/new`}><Button size="sm">New subscription</Button></Link> : undefined}
          />
        ) : (
          <TableWrap dimmed={query.isPlaceholderData}>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Subscription</th>
                  {staff && <th className={thClass}>Customer</th>}
                  <th className={thClass}>Plan</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Next billing</th>
                  <th className={clsx(thClass, "text-right")}>Per period</th>
                </tr>
              </THead>
              <tbody className="divide-y divide-border">
                {data?.items.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-2/60">
                    <td className={tdClass}>
                      <Link href={`${basePath}/${s.id}`} className="font-medium text-primary hover:underline">
                        {s.number}
                      </Link>
                      <p className="text-xs text-muted">Started {formatDate(s.startDate)}</p>
                    </td>
                    {staff && (
                      <td className={tdClass}>
                        <Link href={`/customers/${s.customer.id}`} className="hover:underline">
                          {s.customer.name}
                        </Link>
                        {s.customer.companyName && <p className="text-xs text-muted">{s.customer.companyName}</p>}
                      </td>
                    )}
                    <td className={tdClass}>
                      {s.plan.name}
                      <p className="text-xs text-muted">{billingCycle(s.plan)}</p>
                    </td>
                    <td className={tdClass}>
                      <StatusBadge status={s.status} />
                    </td>
                    <td className={tdClass}>{formatDate(s.nextBillingDate)}</td>
                    <td className={clsx(tdClass, "text-right tabular-nums")}>
                      {formatMoney(s.totals.total)}
                      <p className="text-xs text-muted">{s.lineCount} {s.lineCount === 1 ? "line" : "lines"}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} noun="subscriptions" onPage={(p) => setQ({ page: String(p) }, { resetPage: false })} />}
      </Card>
    </>
  );
}

/** Compact version for a customer's detail page: no header/filters, just their rows. */
export function CustomerSubscriptionsTable({ customerId }: { customerId: string }) {
  const query = useSubscriptions({ customerId, sort: "-createdAt" });
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} message="Could not load subscriptions." />;
  const items = query.data.items;
  if (items.length === 0) return <EmptyState title="No subscriptions yet" />;
  return (
    <TableWrap>
      <table className="w-full text-sm">
        <THead>
          <tr>
            <th className={thClass}>Subscription</th>
            <th className={thClass}>Plan</th>
            <th className={thClass}>Status</th>
            <th className={clsx(thClass, "text-right")}>Per period</th>
          </tr>
        </THead>
        <tbody className="divide-y divide-border">
          {items.map((s) => (
            <tr key={s.id}>
              <td className={tdClass}>
                <Link href={`/subscriptions/${s.id}`} className="font-medium text-primary hover:underline">
                  {s.number}
                </Link>
              </td>
              <td className={tdClass}>{s.plan.name}</td>
              <td className={tdClass}>
                <StatusBadge status={s.status} />
              </td>
              <td className={clsx(tdClass, "text-right tabular-nums")}>{formatMoney(s.totals.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
