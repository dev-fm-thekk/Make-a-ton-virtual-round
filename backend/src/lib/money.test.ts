import { describe, expect, it } from "vitest";
import { D, lineAmounts, money, round2, sum } from "./money.js";

describe("money", () => {
  it("formats as fixed two decimals, never a float", () => {
    expect(money("1250")).toBe("1250.00");
    expect(money(D("0.1").plus("0.2"))).toBe("0.30");
    expect(money(null)).toBe("0.00");
  });
  it("rounds half up", () => {
    expect(round2("2.675").toFixed(2)).toBe("2.68");
    expect(round2("2.665").toFixed(2)).toBe("2.67");
    expect(round2("0.005").toFixed(2)).toBe("0.01");
  });
  it("sums exactly", () => {
    expect(sum(["0.1", "0.2", "0.3"]).toFixed(2)).toBe("0.60");
  });
});

describe("lineAmounts", () => {
  it("computes amount and tax on the rounded amount", () => {
    const r = lineAmounts(3, "19.99", "18");
    expect(r.amount.toFixed(2)).toBe("59.97");
    expect(r.tax.toFixed(2)).toBe("10.79"); // 59.97 x 18% = 10.7946
    expect(r.total.toFixed(2)).toBe("70.76");
  });
  it("handles the variant example: base + 560 extra", () => {
    const r = lineAmounts(2, D("1000").plus("560"), 0);
    expect(r.amount.toFixed(2)).toBe("3120.00");
    expect(r.tax.toFixed(2)).toBe("0.00");
  });
});
