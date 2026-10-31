import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { SubscriptionsList } from "@/features/subscriptions/subscriptions-list";

export const metadata: Metadata = { title: "My subscriptions" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SubscriptionsList mode="customer" basePath="/my/subscriptions" />
    </Suspense>
  );
}
