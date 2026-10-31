import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { PlansList } from "@/features/plans/plans-list";

export const metadata: Metadata = { title: "Plans" };

export const instant = false; // see the note in app/layout.tsx

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PlansList />
    </Suspense>
  );
}
