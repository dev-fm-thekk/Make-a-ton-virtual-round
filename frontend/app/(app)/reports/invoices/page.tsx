import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { InvoicesReport } from "@/features/reports/invoices-report";

export const metadata: Metadata = { title: "Invoice report" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InvoicesReport />
    </Suspense>
  );
}
