"use client";

import clsx from "clsx";
import Link from "next/link";
import { EmptyState, ErrorState, LoadingState, Pagination, SearchInput, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Badge, Card, Select } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { useUrlParams } from "@/lib/hooks";
import { useInvoicesReport } from "./api";
import { RangeBar, useReportRange } from "./range-bar";
import type { InvoiceItem, InvoiceState } from "./types";

const DEFAULTS = { state: "all", search: "", sort: "-issueDate" };
const STATE_TONE: Record<InvoiceItem["paymentState"], "success" | "danger" | "neutral"> = { paid: "success", overdue: "danger", outstanding: "neutral" };
const STATE_LABEL: Record<InvoiceItem["paymentState"], string> = { paid: "Paid", overdue: "Overdue", outstanding: "Outstanding" };

export function InvoicesReport() {
  const range = useReportRange(true);
  const [q, setQ] = useUrlParams({ ...DEFAULTS, page: "1" });
  const query = useInvoicesReport({ page: Number(q.page), state: q.state as InvoiceState, from: range.range?.from, to: range.range?.to, search: q.search, sort: q.sort });
  const data = query.data;

  return (
    <>
      <RangeBar value={range} />
      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput value={q.search} onChange={(search) => setQ({ search })} placeholder="Search invoice number or customer" label="Search invoices" />
        <Select aria-label="Payment status" value={q.state} onChange={(e) => setQ({ state: e.target.value })} className="w-48">
          <option value="all">All invoices</option>
          <option value="outstanding">Outstanding (unpaid)</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
        </Select>
        <Select aria-label="Sort" value={q.sort} onChange={(e) => setQ({ sort: e.target.value })} className="w-48">
          <option value="-issueDate">Newest first</option>
          <option value="issueDate">Oldest first</option>
          <option value="dueDate">Due soonest</option>
          <option value="-total">Largest first</option>
        </Select>
      </div>

      {data && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Summary label={`${data.totals.invoices} invoice${data.totals.invoices === 1 ? "" : "s"}`} value={formatMoney(data.totals.total)} sub="Invoiced" />
          <Summary label="Paid" value={formatMoney(data.totals.paid)} sub="Received against these" />
          <Summary label="Still owed" value={formatMoney(data.totals.balance)} sub="Balance" danger={Number(data.totals.balance) > 0 && q.state === "overdue"} />
        </div>
      )}

      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message="Could not load invoices." onRetry={() => void query.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No invoices match" hint="Try another status or date range." />
        ) : (
          <TableWrap dimmed={query.isPlaceholderData}>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Invoice</th>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>Issued</th>
                  <th className={thClass}>Due</th>
                  <th className={thClass}>Status</th>
                  <th className={clsx(thClass, "text-right")}>Total</th>
                  <th className={clsx(thClass, "text-right")}>Balance</th>
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
                    </td>
                    <td className={tdClass}>{formatDate(i.issueDate)}</td>
                    <td className={tdClass}>
                      {formatDate(i.dueDate)}
                      {i.daysOverdue > 0 && <p className="text-xs text-danger">{i.daysOverdue} days late</p>}
                    </td>
                    <td className={tdClass}>
                      <Badge tone={STATE_TONE[i.paymentState]}>{STATE_LABEL[i.paymentState]}</Badge>
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

function Summary({ label, value, sub, danger }: { label: string; value: string; sub: string; danger?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">
        {sub} · {label}
      </p>
      <p className={clsx("mt-1 text-xl font-semibold tabular-nums", danger && "text-danger")}>{value}</p>
    </Card>
  );
}
