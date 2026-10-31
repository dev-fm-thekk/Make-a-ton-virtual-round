import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { PaymentTermsPage } from "@/features/catalog/terms-page";

export const metadata: Metadata = { title: "Payment terms" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PaymentTermsPage />
    </Suspense>
  );
}
