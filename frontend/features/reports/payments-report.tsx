"use client";

import clsx from "clsx";
import Link from "next/link";
import { EmptyState, ErrorState, LoadingState, Pagination, SearchInput, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Card, Select } from "@/components/ui";
import { formatDateTime, formatMoney, plural } from "@/lib/format";
import { useUrlParams } from "@/lib/hooks";
import { usePaymentsReport } from "./api";
import { HBarChart } from "./charts/h-bar-chart";
import { RangeBar, useReportRange } from "./range-bar";
import { PAYMENT_METHOD_LABEL as METHOD_LABEL } from "../invoices/labels";
import type { PaymentMethod } from "./types";

const DEFAULTS = { method: "", search: "", sort: "-paidAt", page: "1" };

export function PaymentsReport() {
  const range = useReportRange(true);
  const [q, setQ] = useUrlParams(DEFAULTS);
  const query = usePaymentsReport({ page: Number(q.page), from: range.range?.from, to: range.range?.to, method: q.method, search: q.search, sort: q.sort });
  const data = query.data;

  return (
    <>
      <RangeBar value={range} />
      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput value={q.search} onChange={(search) => setQ({ search })} placeholder="Search reference, invoice or customer" label="Search payments" />
        <Select aria-label="Payment method" value={q.method} onChange={(e) => setQ({ method: e.target.value })} className="w-48">
          <option value="">All methods</option>
          {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </Select>
        <Select aria-label="Sort" value={q.sort} onChange={(e) => setQ({ sort: e.target.value })} className="w-44">
          <option value="-paidAt">Newest first</option>
          <option value="paidAt">Oldest first</option>
          <option value="-amount">Largest first</option>
        </Select>
      </div>

      {data && data.totals.payments > 0 && (
        <Card className="mb-4 grid gap-6 p-5 md:grid-cols-[14rem_1fr]">
          <div>
            <p className="text-sm text-muted">Received</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(data.totals.amount)}</p>
            <p className="text-xs text-muted">{plural(data.totals.payments, "payment")}</p>
          </div>
          <HBarChart
            ariaLabel="Amount received by payment method"
            stale={query.isPlaceholderData}
            data={[...data.byMethod].sort((a, b) => Number(b.amount) - Number(a.amount)).map((m) => ({ label: METHOD_LABEL[m.method], value: Number(m.amount), display: formatMoney(m.amount), sub: plural(m.payments, "payment") }))}
          />
        </Card>
      )}

      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message="Could not load payments." onRetry={() => void query.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState title="No payments match" hint="Try another method or date range." />
        ) : (
          <TableWrap dimmed={query.isPlaceholderData}>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Date</th>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>Invoice</th>
                  <th className={thClass}>Method</th>
                  <th className={thClass}>Reference</th>
                  <th className={clsx(thClass, "text-right")}>Amount</th>
                </tr>
              </THead>
              <tbody className="divide-y divide-border">
                {data?.items.map((p) => (
                  <tr key={p.id}>
                    <td className={tdClass}>{formatDateTime(p.paidAt)}</td>
                    <td className={tdClass}>
                      <Link href={`/customers/${p.customer.id}`} className="hover:underline">
                        {p.customer.name}
                      </Link>
                    </td>
                    <td className={tdClass}>{p.invoice.number ?? "—"}</td>
                    <td className={tdClass}>{METHOD_LABEL[p.method]}</td>
                    <td className={`${tdClass} text-muted`}>{p.reference ?? "—"}</td>
                    <td className={clsx(tdClass, "text-right font-medium tabular-nums")}>{formatMoney(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} noun="payments" onPage={(p) => setQ({ page: String(p) }, { resetPage: false })} />}
      </Card>
    </>
  );
}
