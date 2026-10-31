"use client";

import clsx from "clsx";
import Link from "next/link";
import { EmptyState, ErrorState, LoadingState, Pagination, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Card, Select } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { useUrlParams } from "@/lib/hooks";
import { billingCycle, STATUS_LABEL, StatusBadge } from "../subscriptions/labels";
import { STATUSES } from "../subscriptions/types";
import { useSubscriptionsReport } from "./api";
import { HBarChart } from "./charts/h-bar-chart";

const DEFAULTS = { status: "ACTIVE", sort: "-mrr", page: "1" };

export function SubscriptionsReport() {
  const [q, setQ] = useUrlParams(DEFAULTS);
  const query = useSubscriptionsReport({ page: Number(q.page), status: q.status, sort: q.sort });
  const data = query.data;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select aria-label="Status" value={q.status} onChange={(e) => setQ({ status: e.target.value })} className="w-48">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Sort" value={q.sort} onChange={(e) => setQ({ sort: e.target.value })} className="w-52">
          <option value="-mrr">Highest recurring revenue</option>
          <option value="mrr">Lowest recurring revenue</option>
          <option value="-startDate">Newest first</option>
          <option value="startDate">Oldest first</option>
        </Select>
      </div>

      {data && (
        <Card className="mb-4 grid gap-6 p-5 md:grid-cols-[14rem_1fr]">
          <div>
            <p className="text-sm text-muted">Monthly recurring revenue</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(data.summary.mrr)}</p>
            <p className="text-xs text-muted">Active subscriptions, before tax</p>
          </div>
          {data.summary.mrrByPlan.length > 0 ? (
            <HBarChart ariaLabel="Monthly recurring revenue by plan" stale={query.isPlaceholderData} data={data.summary.mrrByPlan.map((p) => ({ label: p.planName, value: Number(p.mrr), display: formatMoney(p.mrr), sub: `${p.subscriptions} subscriptions` }))} />
          ) : (
            <p className="self-center text-sm text-muted">No active subscriptions.</p>
          )}
        </Card>
      )}

      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message="Could not load subscriptions." onRetry={() => void query.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No subscriptions match" />
        ) : (
          <TableWrap dimmed={query.isPlaceholderData}>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Subscription</th>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>Plan</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Next billing</th>
                  <th className={clsx(thClass, "text-right")}>Per period</th>
                  <th className={clsx(thClass, "text-right")}>Monthly (MRR)</th>
                </tr>
              </THead>
              <tbody className="divide-y divide-border">
                {data?.items.map((s) => (
                  <tr key={s.id}>
                    <td className={tdClass}>
                      <Link href={`/subscriptions/${s.id}`} className="font-medium text-primary hover:underline">
                        {s.number}
                      </Link>
                    </td>
                    <td className={tdClass}>
                      <Link href={`/customers/${s.customer.id}`} className="hover:underline">
                        {s.customer.name}
                      </Link>
                    </td>
                    <td className={tdClass}>
                      {s.plan.name}
                      <p className="text-xs text-muted">{billingCycle({ billingPeriod: s.plan.billingPeriod as never, billingInterval: s.plan.billingInterval })}</p>
                    </td>
                    <td className={tdClass}>
                      <StatusBadge status={s.status} />
                    </td>
                    <td className={tdClass}>{formatDate(s.nextBillingDate)}</td>
                    <td className={clsx(tdClass, "text-right tabular-nums")}>{formatMoney(s.amountPerPeriod)}</td>
                    <td className={clsx(tdClass, "text-right font-medium tabular-nums")}>{s.status === "ACTIVE" ? formatMoney(s.mrr) : <span className="text-muted">—</span>}</td>
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
