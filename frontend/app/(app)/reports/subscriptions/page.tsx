import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { SubscriptionsReport } from "@/features/reports/subscriptions-report";

export const metadata: Metadata = { title: "Subscription report" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SubscriptionsReport />
    </Suspense>
  );
}
