"use client";

import { PageHeader } from "@/components/ui";
import { PaymentsReport } from "./payments-report";

/** The money that has come in: filter by date, method or customer. Same data as Reports → Payments. */
export function PaymentsPage() {
  return (
    <>
      <PageHeader title="Payments" description="Every payment received. To record one, open the invoice it belongs to." />
      <PaymentsReport />
    </>
  );
}
