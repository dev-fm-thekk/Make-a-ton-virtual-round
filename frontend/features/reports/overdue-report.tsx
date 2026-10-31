"use client";

import clsx from "clsx";
import Link from "next/link";
import { EmptyState, ErrorState, LoadingState, Pagination, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Card, Select } from "@/components/ui";
import { formatDate, formatMoney, plural } from "@/lib/format";
import { useUrlParams } from "@/lib/hooks";
import { useOverdue } from "./api";
import { HBarChart } from "./charts/h-bar-chart";

const DEFAULTS = { minDaysOverdue: "", sort: "dueDate", page: "1" };

/** Invoices past their due date, oldest first, so they can be chased before they turn into lost revenue. */
export function OverdueReport() {
  const [q, setQ] = useUrlParams(DEFAULTS);
  const query = useOverdue({ page: Number(q.page), minDaysOverdue: q.minDaysOverdue, sort: q.sort });
  const data = query.data;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select aria-label="How late" value={q.minDaysOverdue} onChange={(e) => setQ({ minDaysOverdue: e.target.value })} className="w-52">
          <option value="">Any lateness</option>
          <option value="31">More than 30 days late</option>
          <option value="61">More than 60 days late</option>
          <option value="91">More than 90 days late</option>
        </Select>
        <Select aria-label="Sort" value={q.sort} onChange={(e) => setQ({ sort: e.target.value })} className="w-52">
          <option value="dueDate">Oldest first</option>
          <option value="-dueDate">Newest first</option>
          <option value="-balance">Largest first</option>
        </Select>
      </div>

      {data && data.summary.invoices > 0 && (
        <Card className="mb-4 grid gap-6 p-5 md:grid-cols-[14rem_1fr]">
          <div>
            <p className="text-sm text-muted">Total overdue</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-danger">{formatMoney(data.summary.amount)}</p>
            <p className="text-xs text-muted">
              {plural(data.summary.invoices, "invoice")} as of {formatDate(data.asOf)}
            </p>
          </div>
          <HBarChart
            ariaLabel="Overdue amount by days past due"
            stale={query.isPlaceholderData}
            data={data.summary.aging.map((b) => ({ label: `${b.bucket} days`, value: Number(b.amount), display: formatMoney(b.amount), sub: plural(b.invoices, "invoice") }))}
          />
        </Card>
      )}

      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message="Could not load overdue invoices." onRetry={() => void query.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState title={q.minDaysOverdue ? "No invoices that late" : "Nothing is overdue"} hint={q.minDaysOverdue ? undefined : "Every invoice past its due date has been paid."} />
        ) : (
          <TableWrap dimmed={query.isPlaceholderData}>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Invoice</th>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>Due</th>
                  <th className={clsx(thClass, "text-right")}>Days late</th>
                  <th className={clsx(thClass, "text-right")}>Total</th>
                  <th className={clsx(thClass, "text-right")}>Still owed</th>
                </tr>
              </THead>
              <tbody className="divide-y divide-border">
                {data?.items.map((i) => (
                  <tr key={i.id}>
                    <td className={tdClass}>
                      <span className="font-medium">{i.number}</span>
                      <p className="text-xs text-muted">
                        <Link href={`/subscriptions/${i.subscription.id}`} className="hover:underline">
                          {i.subscription.number}
                        </Link>
                      </p>
                    </td>
                    <td className={tdClass}>
                      <Link href={`/customers/${i.customer.id}`} className="hover:underline">
                        {i.customer.name}
                      </Link>
                      {i.customer.email && <p className="text-xs text-muted">{i.customer.email}</p>}
                    </td>
                    <td className={tdClass}>{formatDate(i.dueDate)}</td>
                    <td className={clsx(tdClass, "text-right font-medium tabular-nums", i.daysOverdue > 60 && "text-danger")}>{i.daysOverdue}</td>
                    <td className={clsx(tdClass, "text-right tabular-nums")}>{formatMoney(i.total)}</td>
                    <td className={clsx(tdClass, "text-right font-medium tabular-nums")}>{formatMoney(i.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} noun="overdue invoices" onPage={(p) => setQ({ page: String(p) }, { resetPage: false })} />}
      </Card>
    </>
  );
}
