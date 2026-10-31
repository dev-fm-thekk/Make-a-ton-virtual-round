import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { InvoicesList } from "@/features/invoices/invoices-list";

export const metadata: Metadata = { title: "Invoices" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InvoicesList mode="staff" basePath="/invoices" />
    </Suspense>
  );
}
