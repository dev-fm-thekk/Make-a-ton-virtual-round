"use client";

import type { ReactNode } from "react";
import { RouteTabs } from "@/components/data/tabs";
import { PageHeader } from "@/components/ui";

const TABS = [
  { href: "/reports", label: "Overview" },
  { href: "/reports/invoices", label: "Invoices" },
  { href: "/reports/payments", label: "Payments" },
  { href: "/reports/overdue", label: "Overdue" },
  { href: "/reports/subscriptions", label: "Subscriptions" },
];

export function ReportsFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="Reports" description="Revenue, what is owed, and who to chase. Dates are UTC." />
      <RouteTabs tabs={TABS} label="Report sections" />
      {children}
    </>
  );
}
