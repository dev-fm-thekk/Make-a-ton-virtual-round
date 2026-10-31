import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { PaymentsReport } from "@/features/reports/payments-report";

export const metadata: Metadata = { title: "Payment report" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PaymentsReport />
    </Suspense>
  );
}
