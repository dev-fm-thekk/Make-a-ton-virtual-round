import { describe, expect, it } from "vitest";
import { allocate, computeInvoice, isRuleLive, type CalcLineInput, type DiscountRule } from "./calc.js";

const line = (key: string, quantity: number, unitPrice: string, productId: string | null = null, tax = "0"): CalcLineInput => ({ key, quantity, unitPrice, productId, taxRatePercent: tax });
const rule = (over: Partial<DiscountRule> & { id: string }): DiscountRule => ({ type: "PERCENTAGE", value: "10", scope: "SUBSCRIPTION", minPurchaseAmount: null, minQuantity: null, productIds: new Set(), ...over });
const money = (d: { toFixed(n: number): string }) => d.toFixed(2);

function expectInvariants(r: ReturnType<typeof computeInvoice>) {
  // These are exactly the database CHECK constraints: they must never be violated by the maths.
  expect(r.total.toFixed(2)).toBe(r.subtotal.minus(r.discountTotal).plus(r.taxTotal).toFixed(2));
  expect(r.discountTotal.lessThanOrEqualTo(r.subtotal)).toBe(true);
  expect(r.lines.reduce((t, l) => t.plus(l.discountAmount), r.discountTotal.minus(r.discountTotal)).toFixed(2)).toBe(r.discountTotal.toFixed(2));
  for (const l of r.lines) {
    expect(l.discountAmount.lessThanOrEqualTo(l.amount)).toBe(true);
    expect(l.lineTotal.toFixed(2)).toBe(l.amount.minus(l.discountAmount).plus(l.taxAmount).toFixed(2));
  }
}

describe("allocate", () => {
  it("splits exactly, no cent lost or invented", () => {
    for (const [total, w] of [[100, [100, 100, 100]], [1, [5, 5, 5]], [999, [3333, 3333, 3334]], [7, [0, 10, 0]], [50, [10, 20, 30]]] as [number, number[]][]) {
      const out = allocate(total, w);
      expect(out.reduce((a, b) => a + b, 0)).toBe(total);
      out.forEach((v, i) => expect(v).toBeLessThanOrEqual(w[i]!));
    }
  });
  it("gives leftover cents to the largest remainders, earlier lines first on ties", () => {
    expect(allocate(100, [100, 100, 100])).toEqual([34, 33, 33]);
  });
  it("handles nothing to split", () => {
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(10, [0, 0])).toEqual([0, 0]);
  });
});

describe("computeInvoice without discounts", () => {
  it("applies tax per line on the rounded amount (the variant example: 1000 + 560)", () => {
    const r = computeInvoice([line("a", 2, "1560.00", "p1", "18")], []);
    expect(r.subtotal.toFixed(2)).toBe("3120.00");
    expect(r.taxTotal.toFixed(2)).toBe("561.60");
    expect(r.total.toFixed(2)).toBe("3681.60");
    expectInvariants(r);
  });
  it("rounds tax half-up per line, then sums (not on the grand total)", () => {
    const r = computeInvoice([line("a", 1, "0.05", null, "10"), line("b", 1, "0.05", null, "10")], []);
    expect(r.taxTotal.toFixed(2)).toBe("0.02"); // 0.005 → 0.01 each
    expectInvariants(r);
  });
  it("handles an empty or zero-priced invoice", () => {
    expect(computeInvoice([], []).total.toFixed(2)).toBe("0.00");
    expect(computeInvoice([line("a", 3, "0")], []).total.toFixed(2)).toBe("0.00");
  });
});

describe("percentage and fixed discounts", () => {
  const lines = [line("a", 1, "100.00", "p1", "18"), line("b", 1, "200.00", "p2", "18")];

  it("subscription-level percentage reduces every line and the tax base", () => {
    const r = computeInvoice(lines, [rule({ id: "d1", value: "10" })]);
    expect(r.discountTotal.toFixed(2)).toBe("30.00");
    expect(r.lines.map((l) => money(l.discountAmount))).toEqual(["10.00", "20.00"]);
    expect(r.taxTotal.toFixed(2)).toBe("48.60"); // 270 × 18%
    expect(r.total.toFixed(2)).toBe("318.60");
    expect(r.applied).toEqual([{ discountId: "d1", amount: expect.anything() }]);
    expectInvariants(r);
  });

  it("product-scoped discount touches only its products", () => {
    const r = computeInvoice(lines, [rule({ id: "d1", scope: "PRODUCT", value: "50", productIds: new Set(["p2"]) })]);
    expect(r.lines.map((l) => money(l.discountAmount))).toEqual(["0.00", "100.00"]);
    expectInvariants(r);
  });

  it("a fixed discount is spread proportionally, to the exact cent", () => {
    const r = computeInvoice([line("a", 1, "10.00"), line("b", 1, "10.00"), line("c", 1, "10.00")], [rule({ id: "d1", type: "FIXED", value: "1.00" })]);
    expect(r.discountTotal.toFixed(2)).toBe("1.00");
    expect(r.lines.map((l) => money(l.discountAmount))).toEqual(["0.34", "0.33", "0.33"]);
    expectInvariants(r);
  });

  it("a fixed discount can never exceed what it applies to", () => {
    const r = computeInvoice([line("a", 1, "30.00")], [rule({ id: "d1", type: "FIXED", value: "500" })]);
    expect(r.discountTotal.toFixed(2)).toBe("30.00");
    expect(r.total.toFixed(2)).toBe("0.00");
    expectInvariants(r);
  });

  it("100% off yields a zero invoice", () => {
    const r = computeInvoice(lines, [rule({ id: "d1", value: "100" })]);
    expect(r.total.toFixed(2)).toBe("0.00");
    expectInvariants(r);
  });
});

describe("eligibility thresholds", () => {
  it("minimum quantity counts only the targeted lines", () => {
    const lines = [line("a", 2, "10.00", "p1"), line("b", 10, "10.00", "p2")];
    const r = (min: number) => computeInvoice(lines, [rule({ id: "d1", scope: "PRODUCT", productIds: new Set(["p1"]), minQuantity: min })]);
    expect(r(3).discountTotal.toFixed(2)).toBe("0.00"); // p1 has only 2
    expect(r(2).discountTotal.toFixed(2)).toBe("2.00");
  });
  it("minimum purchase is measured on the original amounts of the targeted lines", () => {
    const lines = [line("a", 1, "100.00", "p1")];
    expect(computeInvoice(lines, [rule({ id: "d1", minPurchaseAmount: "100.01" })]).discountTotal.toFixed(2)).toBe("0.00");
    expect(computeInvoice(lines, [rule({ id: "d1", minPurchaseAmount: "100.00" })]).discountTotal.toFixed(2)).toBe("10.00");
  });
  it("a product discount whose products are absent does nothing", () => {
    expect(computeInvoice([line("a", 1, "50", "p9")], [rule({ id: "d1", scope: "PRODUCT", productIds: new Set(["p1"]) })]).applied).toEqual([]);
  });
});

describe("stacking", () => {
  const lines = [line("a", 1, "100.00", "p1", "0")];
  it("applies product discounts before subscription ones, each on what is left", () => {
    const r = computeInvoice(lines, [
      rule({ id: "z-sub", scope: "SUBSCRIPTION", value: "10" }), // listed first on purpose
      rule({ id: "a-prod", scope: "PRODUCT", value: "50", productIds: new Set(["p1"]) }),
    ]);
    // 100 → 50% off = 50 → 10% of the remaining 50 = 5
    expect(r.applied.map((a) => [a.discountId, money(a.amount)])).toEqual([["a-prod", "50.00"], ["z-sub", "5.00"]]);
    expect(r.total.toFixed(2)).toBe("45.00");
    expectInvariants(r);
  });
  it("is deterministic regardless of input order", () => {
    const a = rule({ id: "d1", value: "10" });
    const b = rule({ id: "d2", value: "20" });
    expect(computeInvoice(lines, [a, b]).total.toFixed(2)).toBe(computeInvoice(lines, [b, a]).total.toFixed(2));
  });
  it("many discounts can never push the invoice below zero", () => {
    const rs = Array.from({ length: 6 }, (_, i) => rule({ id: `d${i}`, type: "FIXED", value: "40" }));
    const r = computeInvoice([line("a", 1, "100.00"), line("b", 1, "50.00")], rs);
    expect(r.total.toFixed(2)).toBe("0.00");
    expectInvariants(r);
  });
});

describe("rounding stress", () => {
  it("keeps every invariant over awkward numbers", () => {
    const awkward = [line("a", 3, "33.33", "p1", "18"), line("b", 7, "0.01", "p2", "12.5"), line("c", 1, "999999.99", "p3", "5"), line("d", 13, "7.77", "p1", "0")];
    const rs = [rule({ id: "d1", value: "33.33" }), rule({ id: "d2", type: "FIXED", value: "17.01", scope: "PRODUCT", productIds: new Set(["p1", "p3"]) }), rule({ id: "d3", value: "7.5", scope: "PRODUCT", productIds: new Set(["p2"]) })];
    expectInvariants(computeInvoice(awkward, rs));
    expectInvariants(computeInvoice(awkward, []));
  });
});

describe("isRuleLive", () => {
  const d = (over = {}) => ({ isActive: true, deletedAt: null, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), usageLimit: 5, usedCount: 4, ...over });
  const on = new Date("2026-06-15");
  it("accepts a rule inside its window with uses left", () => expect(isRuleLive(d(), on)).toBe(true));
  it("includes the first and last day", () => {
    expect(isRuleLive(d(), new Date("2026-01-01"))).toBe(true);
    expect(isRuleLive(d(), new Date("2026-12-31"))).toBe(true);
  });
  it("rejects before start, after end, inactive, deleted, or used up", () => {
    expect(isRuleLive(d(), new Date("2025-12-31"))).toBe(false);
    expect(isRuleLive(d(), new Date("2027-01-01"))).toBe(false);
    expect(isRuleLive(d({ isActive: false }), on)).toBe(false);
    expect(isRuleLive(d({ deletedAt: new Date() }), on)).toBe(false);
    expect(isRuleLive(d({ usedCount: 5 }), on)).toBe(false);
  });
  it("treats no end date / no limit as open-ended", () => expect(isRuleLive(d({ endDate: null, usageLimit: null, usedCount: 999 }), on)).toBe(true));
});
