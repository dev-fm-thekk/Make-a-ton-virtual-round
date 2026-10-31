"use client";

// Route-level wrappers: read the dynamic segment on the client and hand it to the view.
// (Pages stay server components that only provide metadata + a Suspense boundary, which Cache Components requires
// for anything that depends on the URL.)

import { useParams } from "next/navigation";
import { CustomerDetailView } from "./customers/customer-detail";
import { SubscriptionDetailView } from "./subscriptions/subscription-detail";

export function CustomerDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return <CustomerDetailView id={id} />;
}

export function SubscriptionDetailRoute({ mode, backHref }: { mode: "staff" | "customer"; backHref: string }) {
  const { id } = useParams<{ id: string }>();
  return <SubscriptionDetailView id={id} mode={mode} backHref={backHref} />;
}
