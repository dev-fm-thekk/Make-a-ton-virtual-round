import { Badge } from "@/components/ui";
import type { BillingPeriod, PlanSummary, SubscriptionAction, SubscriptionStatus } from "./types";

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  DRAFT: "Draft",
  QUOTATION: "Quotation",
  CONFIRMED: "Confirmed",
  ACTIVE: "Active",
  PAUSED: "Paused",
  CLOSED: "Closed",
};

const STATUS_TONE: Record<SubscriptionStatus, "neutral" | "primary" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  QUOTATION: "warning",
  CONFIRMED: "primary",
  ACTIVE: "success",
  PAUSED: "warning",
  CLOSED: "danger",
};

/** Always text + colour (never colour alone). */
export function StatusBadge({ status }: { status: SubscriptionStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

const PERIOD_ONE: Record<BillingPeriod, string> = { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" };
const PERIOD_UNIT: Record<BillingPeriod, string> = { DAILY: "days", WEEKLY: "weeks", MONTHLY: "months", YEARLY: "years" };

/** "Monthly" or "Every 3 months". */
export function billingCycle(plan: Pick<PlanSummary, "billingPeriod" | "billingInterval">): string {
  return plan.billingInterval === 1 ? PERIOD_ONE[plan.billingPeriod] : `Every ${plan.billingInterval} ${PERIOD_UNIT[plan.billingPeriod]}`;
}

export interface ActionMeta {
  label: string;
  /** Past-tense toast. */
  done: string;
  variant: "primary" | "secondary" | "danger";
  description: string;
  /** Extra input the API needs for this action. */
  needs?: "reason" | "expiry";
}

export const ACTIONS: Record<SubscriptionAction, ActionMeta> = {
  send_quotation: { label: "Send quotation", done: "Quotation sent", variant: "primary", description: "Moves this subscription to Quotation so the customer can review and accept it." },
  confirm: { label: "Accept quotation", done: "Quotation accepted", variant: "primary", description: "Confirms the terms. Staff can then activate the subscription." },
  activate: { label: "Activate", done: "Subscription activated", variant: "primary", description: "Starts the subscription. The first invoice is scheduled from the billing date shown." },
  pause: { label: "Pause", done: "Subscription paused", variant: "secondary", description: "Stops invoicing until it is resumed. Paused periods are not billed afterwards." },
  resume: { label: "Resume", done: "Subscription resumed", variant: "primary", description: "Restarts invoicing from the next scheduled date." },
  renew: { label: "Renew", done: "Subscription renewed", variant: "secondary", description: "Extends the expiry date. Billing continues on the same schedule.", needs: "expiry" },
  close: { label: "Close", done: "Subscription closed", variant: "danger", description: "Ends the subscription and stops all future invoicing. This cannot be undone.", needs: "reason" },
};

/** Order buttons are shown in: the forward step first, destructive last. */
export const ACTION_ORDER: SubscriptionAction[] = ["send_quotation", "confirm", "activate", "resume", "pause", "renew", "close"];

/** Server error codes → plain-language messages. Falls back to the server message. */
export const ERROR_HINTS: Record<string, string> = {
  STALE_VERSION: "Someone else changed this subscription. It has been reloaded, so please review and try again.",
  INVALID_TRANSITION: "That step isn't available from the current status.",
  PLAN_RULE: "This plan's rules don't allow that.",
  PLAN_UNAVAILABLE: "This plan is not available for sale right now.",
  QUOTE_EXPIRED: "This quotation has expired. Ask for a new one.",
  MIN_QUANTITY: "The total quantity is below this plan's minimum.",
  NO_LINES: "Add at least one product line first.",
  NOT_EDITABLE: "This subscription can no longer be edited.",
  NO_EXPIRY: "This subscription has no expiry date to renew.",
};
