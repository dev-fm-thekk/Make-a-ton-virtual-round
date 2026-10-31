import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { OverdueReport } from "@/features/reports/overdue-report";

export const metadata: Metadata = { title: "Overdue invoices" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <OverdueReport />
    </Suspense>
  );
}
