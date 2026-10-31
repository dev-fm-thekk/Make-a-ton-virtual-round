import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { SubscriptionForm } from "@/features/subscriptions/subscription-form";

export const metadata: Metadata = { title: "New subscription" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SubscriptionForm />
    </Suspense>
  );
}
