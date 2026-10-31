import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState } from "@/components/data/list-parts";
import { ReportsOverviewPage } from "@/features/reports/overview-page";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ReportsOverviewPage />
    </Suspense>
  );
}
