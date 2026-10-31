import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { PaymentsPage } from "@/features/reports/payments-page";

export const metadata: Metadata = { title: "Payments" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PaymentsPage />
    </Suspense>
  );
}
