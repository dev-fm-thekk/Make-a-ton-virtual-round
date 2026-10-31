import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { DiscountsList } from "@/features/discounts/discounts-list";

export const metadata: Metadata = { title: "Discounts" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <DiscountsList />
    </Suspense>
  );
}
