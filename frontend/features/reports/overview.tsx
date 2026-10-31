"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ErrorState, LoadingState } from "@/components/data/list-parts";
import { Card } from "@/components/ui";
import { formatCount, formatDate, formatMoney, formatMoneyCompact, formatMonth, plural } from "@/lib/format";
import { useOverdue, useRevenue, useSubscriptionsReport, useSummary } from "./api";
import { HBarChart } from "./charts/h-bar-chart";
import { LineChart } from "./charts/line-chart";
import { allowedGroupBy, defaultGroupBy, type Range } from "./range";
import type { GroupBy, RevenuePoint } from "./types";
import { STATUS_LABEL } from "../subscriptions/labels";
import { STATUSES } from "../subscriptions/types";

/** The finance picture for a date range: headline numbers, revenue over time, who owes what, and recurring revenue. */
export function FinanceOverview({ range, detailHrefSuffix = "" }: { range: Range; /** keeps the chosen range when drilling into a detail tab */ detailHrefSuffix?: string }) {
  const summary = useSummary(range.from, range.to);
  const overdue = useOverdue({ limit: 1 });
  const subs = useSubscriptionsReport({ limit: 1 });

  return (
    <div className="space-y-6">
      <KpiGrid q={summary} suffix={detailHrefSuffix} />
      <RevenueCard range={range} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Overdue by age" subtitle={overdue.data ? `As of ${formatDate(overdue.data.asOf)}` : undefined} href={`/reports/overdue${detailHrefSuffix}`} linkLabel="View overdue invoices">
          {overdue.isPending ? (
            <LoadingState />
          ) : overdue.isError ? (
            <ErrorState onRetry={() => void overdue.refetch()} />
          ) : overdue.data.summary.invoices === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Nothing is overdue. 🎉</p>
          ) : (
            <>
              <HBarChart
                ariaLabel="Overdue amount by days past due"
                stale={overdue.isPlaceholderData}
                data={overdue.data.summary.aging.map((b) => ({ label: `${b.bucket} days`, value: Number(b.amount), display: formatMoney(b.amount), sub: plural(b.invoices, "invoice") }))}
              />
              <p className="mt-4 border-t border-border pt-3 text-sm text-muted">
                Total overdue <span className="font-semibold text-foreground">{formatMoney(overdue.data.summary.amount)}</span> across {plural(overdue.data.summary.invoices, "invoice")}
              </p>
            </>
          )}
        </Panel>

        <Panel title="Recurring revenue by plan" subtitle="Monthly, active subscriptions" href={`/reports/subscriptions${detailHrefSuffix}`} linkLabel="View subscriptions">
          {subs.isPending ? (
            <LoadingState />
          ) : subs.isError ? (
            <ErrorState onRetry={() => void subs.refetch()} />
          ) : subs.data.summary.mrrByPlan.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No active subscriptions yet.</p>
          ) : (
            <>
              <HBarChart
                ariaLabel="Monthly recurring revenue by plan"
                stale={subs.isPlaceholderData}
                data={subs.data.summary.mrrByPlan.map((p) => ({ label: p.planName, value: Number(p.mrr), display: formatMoney(p.mrr), sub: plural(p.subscriptions, "subscription") }))}
              />
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-sm text-muted">
                {STATUSES.map((s) => (
                  <li key={s}>
                    {STATUS_LABEL[s]} <span className="font-semibold text-foreground">{formatCount(subs.data.summary.byStatus[s] ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ───────── headline numbers ─────────

function KpiGrid({ q, suffix }: { q: ReturnType<typeof useSummary>; suffix: string }) {
  if (q.isPending) return <Card><LoadingState label="Loading numbers" /></Card>;
  if (q.isError) return <Card><ErrorState message="Could not load the summary." onRetry={() => void q.refetch()} /></Card>;
  const s = q.data;
  const late = Number(s.outstanding.overdueAmount) > 0;
  return (
    <div className={clsx("grid gap-4 sm:grid-cols-2 xl:grid-cols-3 transition-opacity", q.isPlaceholderData && "opacity-60")}>
      <Kpi label="Monthly recurring revenue" value={formatMoney(s.recurringRevenue.mrr)} sub={`${formatMoney(s.recurringRevenue.arr)} a year`} />
      <Kpi label="Active subscriptions" value={formatCount(s.subscriptions.active)} sub={`+${formatCount(s.subscriptions.activatedInRange)} started · ${formatCount(s.subscriptions.closedInRange)} closed in period`} href={`/subscriptions?status=ACTIVE`} />
      <Kpi label="Collected" value={formatMoney(s.revenue.collected)} sub={`${plural(s.revenue.payments, "payment")} received`} href={`/reports/payments${suffix}`} />
      <Kpi label="Invoiced" value={formatMoney(s.invoiced.total)} sub={`${plural(s.invoiced.invoices, "invoice")} · ${formatCount(s.invoiced.paidInFull)} paid in full`} href={`/reports/invoices${suffix}`} />
      <Kpi label="Outstanding" value={formatMoney(s.outstanding.amount)} sub={`${plural(s.outstanding.invoices, "unpaid invoice")}`} href="/reports/invoices?state=outstanding" />
      <Kpi label="Overdue" value={formatMoney(s.outstanding.overdueAmount)} sub={late ? `${plural(s.outstanding.overdueInvoices, "invoice")} past due` : "Nothing late"} tone={late ? "danger" : undefined} href="/reports/overdue" />
    </div>
  );
}

function Kpi({ label, value, sub, href, tone }: { label: string; value: string; sub: string; href?: string; tone?: "danger" }) {
  const body = (
    <Card className={clsx("h-full p-5 transition-colors", href && "hover:border-primary")}>
      <p className="text-sm text-muted">{label}</p>
      <p className={clsx("mt-1 text-2xl font-semibold tabular-nums", tone === "danger" && "text-danger")}>{value}</p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

// ───────── revenue over time ─────────

function RevenueCard({ range }: { range: Range }) {
  const allowed = allowedGroupBy(range);
  const [chosen, setChosen] = useState<GroupBy | null>(null);
  const groupBy: GroupBy = chosen && allowed.includes(chosen) ? chosen : defaultGroupBy(range);
  const q = useRevenue(range.from, range.to, groupBy);

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Revenue over time</h2>
          <p className="text-sm text-muted">Money received vs. invoiced, per {groupBy}.</p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Group by">
          {allowed.map((g) => (
            <button
              key={g}
              aria-pressed={g === groupBy}
              onClick={() => setChosen(g)}
              className={clsx("rounded-md border px-2.5 py-1 text-xs capitalize", g === groupBy ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted hover:text-foreground")}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <>
          <LineChart
            ariaLabel={`Revenue collected and invoiced per ${groupBy}, ${formatDate(range.from)} to ${formatDate(range.to)}`}
            stale={q.isPlaceholderData}
            labels={q.data.points.map((p) => bucketLabel(p, groupBy))}
            series={[
              { name: "Collected", color: "var(--series-1)", values: q.data.points.map((p) => Number(p.collected)) },
              { name: "Invoiced", color: "var(--series-2)", values: q.data.points.map((p) => Number(p.invoiced)) },
            ]}
            formatValue={formatMoney}
            formatTick={formatMoneyCompact}
          />
          <p className="mt-3 text-sm text-muted">
            In this period: <span className="font-semibold text-foreground">{formatMoney(q.data.totals.collected)}</span> collected,{" "}
            <span className="font-semibold text-foreground">{formatMoney(q.data.totals.invoiced)}</span> invoiced.
          </p>
        </>
      )}
    </Card>
  );
}

function bucketLabel(p: RevenuePoint, g: GroupBy): string {
  if (g === "month") return formatMonth(p.bucket);
  return g === "week" ? `Week of ${formatDate(p.bucket)}` : formatDate(p.bucket);
}

function Panel({ title, subtitle, href, linkLabel, children }: { title: string; subtitle?: string; href: string; linkLabel: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        <Link href={href} className="shrink-0 text-sm text-primary hover:underline">
          {linkLabel}
        </Link>
      </div>
      <div className="flex-1">{children}</div>
    </Card>
  );
}
