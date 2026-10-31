// Subscription lifecycle as data. The service never hand-codes a transition: it asks this table.
//
//   DRAFT ──send_quotation──▶ QUOTATION ──confirm──▶ CONFIRMED ──activate──▶ ACTIVE ◀──resume── PAUSED
//                                                                              │  └───pause────▶  │
//                                                                  close ◀─────┴──────────────────┘
//   (DRAFT | QUOTATION | CONFIRMED can also be closed = cancelled before it ever went live)

import type { Role, SubscriptionStatus } from "../../generated/prisma/client.js";

export type SubscriptionAction = "send_quotation" | "confirm" | "activate" | "pause" | "resume" | "close" | "renew";

export interface TransitionRule {
  from: SubscriptionStatus[];
  /** Resulting status. `renew` keeps the status (it only extends the expiry). */
  to: SubscriptionStatus;
  /** Who may trigger it. Customers may only act on their own subscriptions (enforced by the service). */
  roles: Role[];
  /** Plan switch that must be on for this action (admin decides plan by plan). */
  planFlag?: "allowPause" | "allowEarlyClose" | "allowRenewal";
  /** Needs lines on the subscription. */
  needsLines?: boolean;
  reasonRequired?: boolean;
}

export const TRANSITIONS: Record<SubscriptionAction, TransitionRule> = {
  send_quotation: { from: ["DRAFT"], to: "QUOTATION", roles: ["ADMIN", "STAFF"], needsLines: true },
  // A customer can accept the quotation they were sent.
  confirm: { from: ["QUOTATION"], to: "CONFIRMED", roles: ["ADMIN", "STAFF", "CUSTOMER"], needsLines: true },
  activate: { from: ["CONFIRMED"], to: "ACTIVE", roles: ["ADMIN", "STAFF"], needsLines: true },
  pause: { from: ["ACTIVE"], to: "PAUSED", roles: ["ADMIN", "STAFF", "CUSTOMER"], planFlag: "allowPause" },
  resume: { from: ["PAUSED"], to: "ACTIVE", roles: ["ADMIN", "STAFF", "CUSTOMER"] },
  // Closing before activation is a plain cancel; closing a live subscription early needs the plan to allow it.
  close: { from: ["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "PAUSED"], to: "CLOSED", roles: ["ADMIN", "STAFF", "CUSTOMER"], reasonRequired: true },
  renew: { from: ["ACTIVE", "PAUSED"], to: "ACTIVE", roles: ["ADMIN", "STAFF", "CUSTOMER"], planFlag: "allowRenewal" },
};

/** Lines may only change while the deal is still being shaped. */
export const EDITABLE_STATUSES: SubscriptionStatus[] = ["DRAFT", "QUOTATION"];

/** Statuses a subscription can be billed in (see billing contract). */
export const BILLABLE_STATUSES: SubscriptionStatus[] = ["ACTIVE"];

export function canTransition(action: SubscriptionAction, from: SubscriptionStatus): boolean {
  return TRANSITIONS[action].from.includes(from);
}

/** Actions currently available from a status (for the UI to show the right buttons). */
export function availableActions(status: SubscriptionStatus, role: Role): SubscriptionAction[] {
  return (Object.keys(TRANSITIONS) as SubscriptionAction[]).filter((a) => canTransition(a, status) && TRANSITIONS[a].roles.includes(role));
}
