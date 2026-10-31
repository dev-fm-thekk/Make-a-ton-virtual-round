import { describe, expect, it } from "vitest";
import { allowedGroupBy, daysIn, defaultGroupBy, resolveRange } from "./range";

const TODAY = "2026-06-15";

describe("resolveRange", () => {
  it("resolves the presets in UTC", () => {
    expect(resolveRange("month", {}, TODAY)).toEqual({ from: "2026-06-01", to: TODAY });
    expect(resolveRange("30d", {}, TODAY)).toEqual({ from: "2026-05-17", to: TODAY });
    expect(resolveRange("90d", {}, TODAY)).toEqual({ from: "2026-03-18", to: TODAY });
    expect(resolveRange("year", {}, TODAY)).toEqual({ from: "2026-01-01", to: TODAY });
  });
  it("uses a valid custom range", () => {
    expect(resolveRange("custom", { from: "2026-01-10", to: "2026-02-20" }, TODAY)).toEqual({ from: "2026-01-10", to: "2026-02-20" });
  });
  it("falls back to this month for a missing, malformed or reversed custom range", () => {
    const fallback = { from: "2026-06-01", to: TODAY };
    expect(resolveRange("custom", {}, TODAY)).toEqual(fallback);
    expect(resolveRange("custom", { from: "x", to: "y" }, TODAY)).toEqual(fallback);
    expect(resolveRange("custom", { from: "2026-03-01", to: "2026-02-01" }, TODAY)).toEqual(fallback);
    expect(resolveRange("nonsense", {}, TODAY)).toEqual(fallback);
    expect(resolveRange("custom", { from: "2015-01-01", to: "2026-06-01" }, TODAY)).toEqual(fallback); // longer than the API allows
  });
});

describe("grouping", () => {
  it("counts days inclusively", () => {
    expect(daysIn({ from: "2026-06-01", to: "2026-06-01" })).toBe(1);
    expect(daysIn({ from: "2026-06-01", to: "2026-06-30" })).toBe(30);
  });
  it("picks day for short ranges, week for medium, month for long", () => {
    expect(defaultGroupBy({ from: "2026-06-01", to: "2026-06-30" })).toBe("day");
    expect(defaultGroupBy({ from: "2026-03-18", to: TODAY })).toBe("week");
    expect(defaultGroupBy({ from: "2025-01-01", to: TODAY })).toBe("month");
  });
  it("never offers a grouping the API would reject (>400 buckets)", () => {
    expect(allowedGroupBy({ from: "2026-06-01", to: "2026-06-30" })).toEqual(["day", "week", "month"]);
    expect(allowedGroupBy({ from: "2024-01-01", to: "2026-06-15" })).toEqual(["week", "month"]);
    expect(allowedGroupBy({ from: "2022-01-01", to: "2026-06-15" })).toEqual(["week", "month"]);
  });
});
