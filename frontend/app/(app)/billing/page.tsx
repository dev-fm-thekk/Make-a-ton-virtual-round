import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { BillingPage } from "@/features/billing/billing-page";

export const metadata: Metadata = { title: "Billing" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <BillingPage />
    </Suspense>
  );
}
