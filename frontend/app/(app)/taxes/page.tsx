import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { TaxesPage } from "@/features/catalog/taxes-page";

export const metadata: Metadata = { title: "Taxes" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <TaxesPage />
    </Suspense>
  );
}
