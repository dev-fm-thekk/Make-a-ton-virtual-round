import { Badge } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import type { Discount, DiscountStatus } from "./api";

const STATUS: Record<DiscountStatus, { label: string; tone: "success" | "neutral" | "warning" | "primary" }> = {
  active: { label: "Active", tone: "success" },
  scheduled: { label: "Scheduled", tone: "primary" },
  expired: { label: "Expired", tone: "neutral" },
  exhausted: { label: "Used up", tone: "warning" },
  inactive: { label: "Inactive", tone: "neutral" },
};

export const STATUS_OPTIONS = Object.entries(STATUS).map(([value, v]) => ({ value, label: v.label }));

export function DiscountStatusBadge({ status }: { status: DiscountStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const formatDiscountValue = (d: Pick<Discount, "type" | "value">) => (d.type === "PERCENTAGE" ? `${Number(d.value)}%` : formatMoney(d.value));

export const SCOPE_LABEL = { PRODUCT: "Specific products", SUBSCRIPTION: "Whole subscription" } as const;

/** "5 of 100 used" / "Unlimited". */
export const usageText = (d: Pick<Discount, "usedCount" | "usageLimit">) => (d.usageLimit === null ? `${d.usedCount} used · unlimited` : `${d.usedCount} of ${d.usageLimit} used`);
