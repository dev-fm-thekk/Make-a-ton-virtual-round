import { describe, expect, it } from "vitest";
import { blockedReason, isEditable } from "./rules";
import type { PlanSummary } from "./types";

const plan = (over: Partial<PlanSummary> = {}): PlanSummary => ({
  id: "p",
  name: "Plan",
  price: "0.00",
  billingPeriod: "MONTHLY",
  billingInterval: 1,
  minQuantity: 1,
  allowPause: true,
  allowEarlyClose: false,
  allowRenewal: true,
  autoCloseOnEnd: false,
  ...over,
});
const facts = (over: object = {}) => ({ status: "ACTIVE" as const, plan: plan(), lines: [{}] as never[], expiryDate: null, quoteValidUntil: null, ...over });
const TODAY = "2026-06-15";

describe("blockedReason", () => {
  it("needs lines before quoting, confirming or activating", () => {
    for (const a of ["send_quotation", "confirm", "activate"] as const) {
      expect(blockedReason(a, facts({ lines: [] }), TODAY)).toMatch(/product line/);
      expect(blockedReason(a, facts(), TODAY)).toBeNull();
    }
  });

  it("blocks accepting an expired quotation, but not one valid today", () => {
    expect(blockedReason("confirm", facts({ quoteValidUntil: "2026-06-14" }), TODAY)).toMatch(/expired/);
    expect(blockedReason("confirm", facts({ quoteValidUntil: TODAY }), TODAY)).toBeNull();
  });

  it("follows the plan switches for pause and renew", () => {
    expect(blockedReason("pause", facts({ plan: plan({ allowPause: false }) }), TODAY)).toMatch(/pausing/);
    expect(blockedReason("renew", facts({ plan: plan({ allowRenewal: false }), expiryDate: "2026-12-31" }), TODAY)).toMatch(/renewed/);
    expect(blockedReason("renew", facts({ expiryDate: null }), TODAY)).toMatch(/no expiry/);
    expect(blockedReason("renew", facts({ expiryDate: "2026-12-31" }), TODAY)).toBeNull();
  });

  it("closing a live subscription early needs the plan's permission, unless it has already ended", () => {
    expect(blockedReason("close", facts(), TODAY)).toMatch(/before its expiry/);
    expect(blockedReason("close", facts({ plan: plan({ allowEarlyClose: true }) }), TODAY)).toBeNull();
    expect(blockedReason("close", facts({ expiryDate: "2026-06-15" }), TODAY)).toBeNull();
    expect(blockedReason("close", facts({ expiryDate: "2026-06-16" }), TODAY)).toMatch(/before its expiry/);
  });

  it("cancelling something that never went live is always allowed", () => {
    for (const status of ["DRAFT", "QUOTATION", "CONFIRMED"] as const) expect(blockedReason("close", facts({ status }), TODAY)).toBeNull();
  });
});

describe("isEditable", () => {
  it("is true only for draft and quotation", () => {
    expect(["DRAFT", "QUOTATION"].every((s) => isEditable(s as never))).toBe(true);
    expect(["CONFIRMED", "ACTIVE", "PAUSED", "CLOSED"].some((s) => isEditable(s as never))).toBe(false);
  });
});
