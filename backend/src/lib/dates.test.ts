import { describe, expect, it } from "vitest";
import { addDays, billingDateOnOrAfter, billingPeriodEnd, nextBillingDate, nthBillingDate, parseDateOnly, toDateOnly } from "./dates.js";

const d = parseDateOnly;
const s = toDateOnly;

describe("parseDateOnly", () => {
  it("parses valid dates at UTC midnight", () => {
    expect(d("2026-03-31").toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });
  it.each(["2026-02-30", "2026-13-01", "26-01-01", "2026-1-1", ""])("rejects %s", (bad) => {
    expect(() => parseDateOnly(bad)).toThrow();
  });
  it("accepts a leap day only in leap years", () => {
    expect(s(d("2028-02-29"))).toBe("2028-02-29");
    expect(() => parseDateOnly("2026-02-29")).toThrow();
  });
});

describe("nthBillingDate - month-end anchors do not drift", () => {
  const anchor = d("2026-01-31");
  it("clamps to the month's last day but returns to the 31st", () => {
    expect([1, 2, 3, 4].map((n) => s(nthBillingDate(anchor, "MONTHLY", 1, n)))).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });
  it("handles intervals (quarterly)", () => {
    expect(s(nthBillingDate(anchor, "MONTHLY", 3, 1))).toBe("2026-04-30");
    expect(s(nthBillingDate(anchor, "MONTHLY", 3, 2))).toBe("2026-07-31");
  });
  it("yearly from a leap day clamps to Feb 28 then back", () => {
    const leap = d("2028-02-29");
    expect([1, 2, 3, 4].map((n) => s(nthBillingDate(leap, "YEARLY", 1, n)))).toEqual(["2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
  });
  it("daily and weekly are plain day arithmetic", () => {
    expect(s(nthBillingDate(d("2026-12-30"), "DAILY", 1, 3))).toBe("2027-01-02");
    expect(s(nthBillingDate(d("2026-12-30"), "WEEKLY", 2, 1))).toBe("2027-01-13");
  });
  it("rolls over the year boundary", () => {
    expect(s(nthBillingDate(d("2026-11-15"), "MONTHLY", 1, 2))).toBe("2027-01-15");
  });
});

describe("nextBillingDate", () => {
  const anchor = d("2026-01-31");
  it("steps through the month-end schedule without drift", () => {
    let cur = anchor;
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      cur = nextBillingDate(anchor, "MONTHLY", 1, cur);
      seen.push(s(cur));
    }
    expect(seen).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
  });
  it("is strictly after the current date, even when current is off-schedule", () => {
    expect(s(nextBillingDate(d("2026-01-10"), "MONTHLY", 1, d("2026-03-20")))).toBe("2026-04-10");
    expect(s(nextBillingDate(d("2026-01-10"), "MONTHLY", 1, d("2026-03-10")))).toBe("2026-04-10");
  });
  it("works for weekly with intervals", () => {
    expect(s(nextBillingDate(d("2026-01-01"), "WEEKLY", 2, d("2026-01-01")))).toBe("2026-01-15");
    expect(s(nextBillingDate(d("2026-01-01"), "WEEKLY", 2, d("2026-01-14")))).toBe("2026-01-15");
  });
  it("works for yearly", () => {
    expect(s(nextBillingDate(d("2026-06-15"), "YEARLY", 1, d("2026-06-15")))).toBe("2027-06-15");
  });
  it("rejects a non-positive interval", () => {
    expect(() => nextBillingDate(anchor, "MONTHLY", 0, anchor)).toThrow();
  });
});

describe("billingPeriodEnd", () => {
  it("runs through the day before the next billing date", () => {
    expect(s(billingPeriodEnd(d("2026-01-01"), "MONTHLY", 1, d("2026-01-01")))).toBe("2026-01-31");
    expect(s(billingPeriodEnd(d("2026-01-31"), "MONTHLY", 1, d("2026-01-31")))).toBe("2026-02-27");
    expect(s(billingPeriodEnd(d("2026-01-01"), "DAILY", 1, d("2026-01-05")))).toBe("2026-01-05");
  });
});

describe("billingDateOnOrAfter", () => {
  const anchor = d("2026-01-15");
  it("returns the anchor if the date is not after it", () => {
    expect(s(billingDateOnOrAfter(anchor, "MONTHLY", 1, d("2025-12-01")))).toBe("2026-01-15");
    expect(s(billingDateOnOrAfter(anchor, "MONTHLY", 1, anchor))).toBe("2026-01-15");
  });
  it("includes a date that lands exactly on the schedule", () => {
    expect(s(billingDateOnOrAfter(anchor, "MONTHLY", 1, d("2026-03-15")))).toBe("2026-03-15");
  });
  it("jumps to the next scheduled date otherwise", () => {
    expect(s(billingDateOnOrAfter(anchor, "MONTHLY", 1, d("2026-03-16")))).toBe("2026-04-15");
  });
});

it("addDays crosses month ends", () => {
  expect(s(addDays(d("2026-02-27"), 3))).toBe("2026-03-02");
});
