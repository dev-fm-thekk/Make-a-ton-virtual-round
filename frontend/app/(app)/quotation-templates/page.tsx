import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { TemplatesList } from "@/features/templates/templates-list";

export const metadata: Metadata = { title: "Quotation templates" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <TemplatesList />
    </Suspense>
  );
}
