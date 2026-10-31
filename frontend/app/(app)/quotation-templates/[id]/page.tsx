import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { TemplateEditorRoute } from "@/features/templates/template-editor";

export const metadata: Metadata = { title: "Quotation template" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <TemplateEditorRoute mode="edit" />
    </Suspense>
  );
}
