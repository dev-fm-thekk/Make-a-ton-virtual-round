// Values derived from a discount's stored fields: pure (no environment, no database), so they are unit-tested.
// The rule for whether a discount actually reduces an invoice lives in billing/calc.ts (`isRuleLive`); this is the
// human-facing label for the same facts.

export type DiscountStatus = "inactive" | "scheduled" | "active" | "expired" | "exhausted";

export interface DiscountFacts {
  isActive: boolean;
  startDate: Date;
  endDate: Date | null;
  usageLimit: number | null;
  usedCount: number;
}

/** Why a discount is (or isn't) being applied today. Checked in the order a person would explain it. */
export function discountStatus(d: DiscountFacts, today: Date): DiscountStatus {
  if (!d.isActive) return "inactive";
  if (d.endDate && d.endDate < today) return "expired";
  if (d.startDate > today) return "scheduled";
  if (d.usageLimit !== null && d.usedCount >= d.usageLimit) return "exhausted";
  return "active";
}

/** Uses left, or null when unlimited. */
export const remainingUses = (d: Pick<DiscountFacts, "usageLimit" | "usedCount">): number | null => (d.usageLimit === null ? null : Math.max(d.usageLimit - d.usedCount, 0));
