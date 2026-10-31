import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { ProductDetailRoute } from "@/features/catalog/product-detail";

export const metadata: Metadata = { title: "Product" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ProductDetailRoute />
    </Suspense>
  );
}
