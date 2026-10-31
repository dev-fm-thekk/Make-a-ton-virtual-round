"use client";

import { FinanceOverview } from "./overview";
import { RangeBar, useRequiredRange } from "./range-bar";

/** The Reports landing tab: pick a range once, and every number and chart below follows it. */
export function ReportsOverviewPage() {
  const r = useRequiredRange();
  // Carry the chosen range into the detail tabs the cards link to.
  const suffix = r.choice === "custom" ? `?range=custom&from=${r.range.from}&to=${r.range.to}` : `?range=${r.choice}`;
  return (
    <>
      <RangeBar value={r} />
      <FinanceOverview range={r.range} detailHrefSuffix={suffix} />
    </>
  );
}
