import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { CustomerDetailRoute } from "@/features/routes";

export const metadata: Metadata = { title: "Customer" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CustomerDetailRoute />
    </Suspense>
  );
}
