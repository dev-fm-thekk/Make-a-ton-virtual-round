import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { CustomersList } from "@/features/customers/customers-list";

export const metadata: Metadata = { title: "Customers" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CustomersList />
    </Suspense>
  );
}
