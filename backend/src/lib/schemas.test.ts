import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ANY_FIELD_MESSAGE, boundedInt, hasAnyField, moneyInput, percentInput, positiveMoneyInput, queryBool } from "./schemas.js";

const ok = (s: z.ZodType, v: unknown) => s.safeParse(v).success;

describe("moneyInput", () => {
  it("accepts amounts with up to 2 decimals, as strings or numbers, and normalises to a string", () => {
    expect(moneyInput.parse("1250")).toBe("1250");
    expect(moneyInput.parse(1250.5)).toBe("1250.5");
    expect(moneyInput.parse(" 0.99 ")).toBe("0.99");
    expect(moneyInput.parse("9999999999.99")).toBe("9999999999.99"); // largest that fits NUMERIC(12,2)
  });
  it("rejects what the database could not store", () => {
    for (const bad of ["", "-1", "1.234", "abc", "12345678901", "1e5", "1,000", null, undefined, {}]) expect(ok(moneyInput, bad), String(bad)).toBe(false);
  });
});

describe("positiveMoneyInput", () => {
  it("rejects zero", () => {
    expect(ok(positiveMoneyInput, "0")).toBe(false);
    expect(ok(positiveMoneyInput, "0.00")).toBe(false);
    expect(ok(positiveMoneyInput, "0.01")).toBe(true);
  });
});

describe("percentInput", () => {
  it("accepts 0 to 100 inclusive", () => {
    for (const v of ["0", "18", "18.5", "99.99", "100", "100.00"]) expect(ok(percentInput, v), v).toBe(true);
  });
  it("rejects over 100, negatives and junk", () => {
    for (const v of ["100.01", "101", "999", "-1", "1.234", "x", ""]) expect(ok(percentInput, v), v).toBe(false);
  });
});

describe("boundedInt", () => {
  it("is strict: no coercion of null, strings or fractions", () => {
    const s = boundedInt(0, 365);
    expect(ok(s, 0)).toBe(true);
    expect(ok(s, 365)).toBe(true);
    for (const bad of [null, "15", 1.5, -1, 366, undefined, Number.NaN]) expect(ok(s, bad), String(bad)).toBe(false);
  });
});

describe("hasAnyField", () => {
  it("is false for an empty patch and true when anything is present, including null", () => {
    expect(hasAnyField({})).toBe(false);
    expect(hasAnyField({ a: undefined })).toBe(false);
    expect(hasAnyField({ a: null })).toBe(true); // clearing a field is a change
    expect(hasAnyField({ a: false })).toBe(true);
    expect(ANY_FIELD_MESSAGE).toMatch(/at least one/);
  });
});

describe("queryBool", () => {
  it("only understands true / false", () => {
    expect(queryBool.parse("true")).toBe(true);
    expect(queryBool.parse("false")).toBe(false);
    expect(queryBool.parse(undefined)).toBeUndefined();
    expect(ok(queryBool, "yes")).toBe(false);
    expect(ok(queryBool, "")).toBe(false);
  });
});
