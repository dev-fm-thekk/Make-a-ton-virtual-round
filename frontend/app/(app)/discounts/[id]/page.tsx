import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { DiscountDetailRoute } from "@/features/discounts/discount-detail";

export const metadata: Metadata = { title: "Discount" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <DiscountDetailRoute />
    </Suspense>
  );
}
