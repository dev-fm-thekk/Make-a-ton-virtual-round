// Client-side mirror of the server's lifecycle rules, used ONLY to explain why a button is disabled
// (instead of letting people click and hit an error). The API still enforces every rule.

import type { SubscriptionAction, SubscriptionDetail } from "./types";

type Facts = Pick<SubscriptionDetail, "status" | "plan" | "lines" | "expiryDate" | "quoteValidUntil">;

/** Why `action` can't be performed right now, or null when it can. `today` is a YYYY-MM-DD string (UTC). */
export function blockedReason(action: SubscriptionAction, s: Facts, today: string): string | null {
  switch (action) {
    case "send_quotation":
    case "activate":
      return s.lines.length === 0 ? "Add at least one product line first" : null;
    case "confirm":
      if (s.lines.length === 0) return "Add at least one product line first";
      if (s.quoteValidUntil && s.quoteValidUntil < today) return "This quotation has expired";
      return null;
    case "pause":
      return s.plan.allowPause ? null : "This plan doesn't allow pausing";
    case "renew":
      if (!s.plan.allowRenewal) return "This plan can't be renewed";
      return s.expiryDate ? null : "There is no expiry date to renew";
    case "close": {
      const live = s.status === "ACTIVE" || s.status === "PAUSED";
      const ended = s.expiryDate !== null && s.expiryDate <= today;
      return live && !ended && !s.plan.allowEarlyClose ? "This plan can't be closed before its expiry date" : null;
    }
    default:
      return null;
  }
}

/** Lines and header details can change only while the deal is still being shaped. */
export const isEditable = (status: SubscriptionDetail["status"]) => status === "DRAFT" || status === "QUOTATION";
