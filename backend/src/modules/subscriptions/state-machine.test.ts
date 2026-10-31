import { describe, expect, it } from "vitest";
import type { SubscriptionStatus } from "../../generated/prisma/client.js";
import { availableActions, canTransition, TRANSITIONS, type SubscriptionAction } from "./state-machine.js";

const ALL: SubscriptionStatus[] = ["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "PAUSED", "CLOSED"];

describe("subscription lifecycle", () => {
  it("follows Draft, Quotation, Confirmed, Active, Closed", () => {
    expect(canTransition("send_quotation", "DRAFT")).toBe(true);
    expect(canTransition("confirm", "QUOTATION")).toBe(true);
    expect(canTransition("activate", "CONFIRMED")).toBe(true);
    expect(canTransition("close", "ACTIVE")).toBe(true);
  });

  it("cannot skip steps", () => {
    expect(canTransition("confirm", "DRAFT")).toBe(false);
    expect(canTransition("activate", "QUOTATION")).toBe(false);
    expect(canTransition("activate", "DRAFT")).toBe(false);
  });

  it("CLOSED is terminal: nothing is allowed from it", () => {
    for (const a of Object.keys(TRANSITIONS) as SubscriptionAction[]) expect(canTransition(a, "CLOSED")).toBe(false);
    expect(availableActions("CLOSED", "ADMIN")).toEqual([]);
  });

  it("pause/resume only toggle between ACTIVE and PAUSED", () => {
    expect(canTransition("pause", "ACTIVE")).toBe(true);
    expect(canTransition("pause", "PAUSED")).toBe(false);
    expect(canTransition("resume", "PAUSED")).toBe(true);
    expect(canTransition("resume", "ACTIVE")).toBe(false);
  });

  it("every non-closed status can be closed (cancelled), and closing needs a reason", () => {
    for (const s of ALL.filter((x) => x !== "CLOSED")) expect(canTransition("close", s)).toBe(true);
    expect(TRANSITIONS.close.reasonRequired).toBe(true);
  });

  it("plan switches guard pause and renewal", () => {
    expect(TRANSITIONS.pause.planFlag).toBe("allowPause");
    expect(TRANSITIONS.renew.planFlag).toBe("allowRenewal");
  });

  it("customers can accept a quote and manage a live subscription, but not shape or activate it", () => {
    expect(availableActions("QUOTATION", "CUSTOMER")).toEqual(["confirm", "close"]);
    expect(availableActions("DRAFT", "CUSTOMER")).toEqual(["close"]);
    expect(availableActions("CONFIRMED", "CUSTOMER")).toEqual(["close"]);
    expect(availableActions("ACTIVE", "CUSTOMER")).toEqual(expect.arrayContaining(["pause", "close", "renew"]));
    expect(availableActions("ACTIVE", "CUSTOMER")).not.toContain("activate");
  });

  it("staff see activate and close on a confirmed subscription", () => {
    expect(availableActions("CONFIRMED", "STAFF")).toEqual(["activate", "close"]);
  });
});
