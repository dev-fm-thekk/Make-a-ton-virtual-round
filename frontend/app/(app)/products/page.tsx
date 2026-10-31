import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { ProductsList } from "@/features/catalog/products-list";

export const metadata: Metadata = { title: "Products" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ProductsList />
    </Suspense>
  );
}
