import { describe, expect, it } from "vitest";
import { discountStatus, remainingUses } from "./derive.js";

const today = new Date("2026-06-15");
const d = (over = {}) => ({ isActive: true, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") as Date | null, usageLimit: 5 as number | null, usedCount: 2, ...over });

describe("discountStatus", () => {
  it("is active inside its window with uses left", () => expect(discountStatus(d(), today)).toBe("active"));
  it("includes the first and last day", () => {
    expect(discountStatus(d(), new Date("2026-01-01"))).toBe("active");
    expect(discountStatus(d(), new Date("2026-12-31"))).toBe("active");
  });
  it("explains why it is not applied", () => {
    expect(discountStatus(d({ isActive: false }), today)).toBe("inactive");
    expect(discountStatus(d({ startDate: new Date("2026-07-01") }), today)).toBe("scheduled");
    expect(discountStatus(d({ endDate: new Date("2026-06-14") }), today)).toBe("expired");
    expect(discountStatus(d({ usedCount: 5 }), today)).toBe("exhausted");
  });
  it("prefers inactive, then expired, over the other reasons", () => {
    expect(discountStatus(d({ isActive: false, usedCount: 5 }), today)).toBe("inactive");
    expect(discountStatus(d({ endDate: new Date("2026-06-14"), usedCount: 5 }), today)).toBe("expired");
  });
  it("no end date and no limit mean open-ended", () => expect(discountStatus(d({ endDate: null, usageLimit: null, usedCount: 999 }), today)).toBe("active"));
});

describe("remainingUses", () => {
  it("counts down, never below zero, and is null when unlimited", () => {
    expect(remainingUses({ usageLimit: 5, usedCount: 2 })).toBe(3);
    expect(remainingUses({ usageLimit: 5, usedCount: 9 })).toBe(0);
    expect(remainingUses({ usageLimit: null, usedCount: 9 })).toBeNull();
  });
});
