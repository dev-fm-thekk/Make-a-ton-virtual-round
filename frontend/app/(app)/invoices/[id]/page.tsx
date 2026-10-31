import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { InvoiceDetailRoute } from "@/features/routes";

export const metadata: Metadata = { title: "Invoice" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InvoiceDetailRoute mode="staff" backHref="/invoices" />
    </Suspense>
  );
}
