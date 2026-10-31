import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { SubscriptionsList } from "@/features/subscriptions/subscriptions-list";

export const metadata: Metadata = { title: "Subscriptions" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SubscriptionsList mode="staff" basePath="/subscriptions" />
    </Suspense>
  );
}
