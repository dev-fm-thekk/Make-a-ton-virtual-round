"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/data/list-parts";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import { SetupChecklist } from "@/features/catalog/setup-checklist";
import { useInvoices } from "@/features/invoices/api";
import { useSubscriptions } from "@/features/subscriptions/api";
import { billingCycle, StatusBadge } from "@/features/subscriptions/labels";
import { FinanceOverview } from "@/features/reports/overview";
import { resolveRange } from "@/features/reports/range";
import { Alert, Card, PageHeader } from "./ui";

/** Staff land on the finance picture for this month; customers on their own subscriptions. */
export function DashboardView() {
  const { user } = useAuth();
  if (!user) return null;
  const first = user.name.split(" ")[0];

  if (user.role === "CUSTOMER") {
    return (
      <>
        <PageHeader title={`Welcome, ${first}`} description="Your subscriptions at a glance." />
        <CustomerHome />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Welcome, ${first}`}
        description="This month at a glance."
        actions={
          <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            Full reports <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      />
      <SetupChecklist />
      <DraftsNotice />
      <FinanceOverview range={resolveRange("month", {}, todayIso())} />
    </>
  );
}

function CustomerHome() {
  const query = useSubscriptions({ sort: "nextBillingDate", limit: 50 });
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <Card><ErrorState onRetry={() => void query.refetch()} message="Could not load your subscriptions." /></Card>;

  const live = query.data.items.filter((s) => s.status === "ACTIVE" || s.status === "PAUSED");
  const upcoming = live.filter((s) => s.status === "ACTIVE" && s.nextBillingDate).sort((a, b) => a.nextBillingDate!.localeCompare(b.nextBillingDate!))[0];
  const total = live.filter((s) => s.status === "ACTIVE").reduce((t, s) => t + Number(s.totals.total), 0);

  if (query.data.items.length === 0) {
    return (
      <Card>
        <EmptyState title="You have no subscriptions yet" hint="When we set one up for you, it will appear here." />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-muted">Active subscriptions</p>
          <p className="mt-1 text-2xl font-semibold">{live.filter((s) => s.status === "ACTIVE").length}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-muted">Next invoice</p>
          <p className="mt-1 text-2xl font-semibold">{upcoming ? formatDate(upcoming.nextBillingDate) : "—"}</p>
          {upcoming && <p className="text-xs text-muted">{upcoming.number}</p>}
        </Card>
        <Card className="p-5">
          <p className="text-sm text-muted">Per billing period (all active)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(total)}</p>
          <p className="text-xs text-muted">Including tax</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold">Your subscriptions</h2>
          <Link href="/my/subscriptions" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        <ul className="divide-y divide-border">
          {query.data.items.slice(0, 5).map((s) => (
            <li key={s.id}>
              <Link href={`/my/subscriptions/${s.id}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-surface-2/60">
                <div>
                  <p className="font-medium">{s.plan.name}</p>
                  <p className="text-xs text-muted">
                    {s.number} · {billingCycle(s.plan)}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="tabular-nums">{formatMoney(s.totals.total)}</span>
                  <StatusBadge status={s.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** Staff nudge: invoices a billing run produced are waiting for someone to review and confirm them. */
function DraftsNotice() {
  const drafts = useInvoices({ status: "DRAFT", limit: 1 });
  const n = drafts.data?.total ?? 0;
  if (n === 0) return null;
  return (
    <div className="mb-6">
      <Alert tone="success">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {n} draft invoice{n === 1 ? " is" : "s are"} waiting for review.
          </span>
          <Link href="/invoices?view=draft" className="font-medium underline">
            Review drafts
          </Link>
        </span>
      </Alert>
    </div>
  );
}
