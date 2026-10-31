import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { SubscriptionDetailRoute } from "@/features/routes";

export const metadata: Metadata = { title: "Subscription" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SubscriptionDetailRoute mode="staff" backHref="/subscriptions" />
    </Suspense>
  );
}
