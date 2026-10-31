import { describe, expect, it } from "vitest";
import { fromCents, lineMath, toCents } from "@/lib/cents";
import { blankLine, fromSavedLines, lineProblem, previewLine, previewTotals, toPayload } from "./preview";
import type { DraftLine, FormOptions, SubscriptionLine } from "./types";

const options: FormOptions = {
  plans: [],
  paymentTerms: [],
  taxes: [
    { id: "gst18", name: "GST", ratePercent: "18.00" },
    { id: "vat5", name: "VAT", ratePercent: "5.00" },
  ],
  templates: [],
  products: [{ id: "odoo", name: "Odoo", type: "SERVICE", salesPrice: "1000.00", taxId: "gst18", variants: [{ id: "brand", attribute: "Brand", value: "Odoo", extraPrice: "560.00" }] }],
};

const line = (over: Partial<DraftLine> = {}): DraftLine => ({ ...blankLine(), productId: "odoo", ...over });

describe("cents maths", () => {
  it("parses and prints exactly", () => {
    expect(toCents("1560.00")).toBe(156000);
    expect(toCents("99.5")).toBe(9950);
    expect(Number.isNaN(toCents("12.345"))).toBe(true);
    expect(Number.isNaN(toCents("abc"))).toBe(true);
    expect(fromCents(56100)).toBe("561.00");
  });
  it("rounds tax half-up like the server (59.97 x 18% = 10.79)", () => {
    expect(lineMath(3, 1999, "18.00")).toEqual({ amount: 5997, tax: 1079, total: 7076 });
    expect(lineMath(1, 5, "10")).toEqual({ amount: 5, tax: 1, total: 6 }); // 0.5 cents rounds up
  });
});

describe("previewLine", () => {
  it("uses catalog price + variant extra and the product's default tax (the 560 Odoo example)", () => {
    const p = previewLine(line({ variantId: "brand", quantity: 2 }), options);
    expect(p.unitCents).toBe(156000);
    expect(p.rate).toBe("18.00");
    expect(p.math).toEqual({ amount: 312000, tax: 56160, total: 368160 });
    expect(p.overridden).toBe(false);
  });
  it("honours a price override and an explicit tax choice", () => {
    const p = previewLine(line({ unitPrice: "99.50", taxChoice: "vat5", quantity: 3 }), options);
    expect(p.math).toEqual({ amount: 29850, tax: 1493, total: 31343 });
    expect(p.overridden).toBe(true);
  });
  it("'none' means untaxed", () => {
    expect(previewLine(line({ taxChoice: "none" }), options).math?.tax).toBe(0);
  });
  it("yields no maths for an invalid quantity or price", () => {
    expect(previewLine(line({ quantity: 0 }), options).math).toBeNull();
    expect(previewLine(line({ unitPrice: "x" }), options).math).toBeNull();
  });
});

describe("previewTotals", () => {
  it("adds only valid lines", () => {
    const t = previewTotals([line({ quantity: 2, variantId: "brand" }), line({ quantity: 0 })], options);
    expect(t).toEqual({ untaxed: "3120.00", tax: "561.60", total: "3681.60" });
  });
});

describe("toPayload", () => {
  it("omits price/tax unless the user changed them, so the server keeps live catalog values", () => {
    expect(toPayload(line({ quantity: 2 }))).toEqual({ productId: "odoo", variantId: null, quantity: 2 });
  });
  it("sends overrides, and null for explicitly untaxed", () => {
    expect(toPayload(line({ unitPrice: " 12.50 ", taxChoice: "none", variantId: "brand" }))).toEqual({ productId: "odoo", variantId: "brand", quantity: 1, unitPrice: "12.50", taxId: null });
    expect(toPayload(line({ taxChoice: "vat5" })).taxId).toBe("vat5");
  });
});

describe("lineProblem", () => {
  it("flags missing product, bad quantity and bad price", () => {
    expect(lineProblem(blankLine())).toMatch(/product/);
    expect(lineProblem(line({ quantity: 0 }))).toMatch(/Quantity/);
    expect(lineProblem(line({ unitPrice: "1.234" }))).toMatch(/price/);
    expect(lineProblem(line())).toBeNull();
  });
});

describe("fromSavedLines", () => {
  const saved = (over: Partial<SubscriptionLine> = {}): SubscriptionLine => ({
    id: "s1", productId: "odoo", productName: "Odoo", variantId: "brand", variantLabel: "Brand: Odoo", description: "", quantity: 2,
    unitPrice: "1560.00", taxId: "gst18", taxName: "GST", taxRatePercent: "18.00", amount: "3120.00", taxAmount: "561.60", total: "3681.60", ...over,
  });
  it("shows catalog-priced lines as defaults (no override)", () => {
    expect(fromSavedLines([saved()], options)[0]).toMatchObject({ unitPrice: "", taxChoice: "", variantId: "brand", quantity: 2 });
  });
  it("keeps a negotiated price and a changed tax as overrides", () => {
    expect(fromSavedLines([saved({ unitPrice: "1200.00", taxId: null })], options)[0]).toMatchObject({ unitPrice: "1200.00", taxChoice: "none" });
  });
});
