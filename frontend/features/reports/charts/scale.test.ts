import { describe, expect, it } from "vitest";
import { labelIndexes, niceTicks } from "./scale";

describe("niceTicks", () => {
  it("covers the max with round steps starting at zero", () => {
    expect(niceTicks(7300)).toEqual([0, 2000, 4000, 6000, 8000]);
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  it("always reaches at least the max", () => {
    for (const m of [3, 99, 1234, 56789, 1e7, 0.37]) expect(niceTicks(m).at(-1)!).toBeGreaterThanOrEqual(m);
  });
  it("copes with empty data", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
  });
});

describe("labelIndexes", () => {
  it("labels everything when it fits", () => {
    expect(labelIndexes(4, 6)).toEqual([0, 1, 2, 3]);
  });
  it("thins out long axes but keeps first and last, within the limit", () => {
    const idx = labelIndexes(90, 6);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(89);
    expect(idx.length).toBeLessThanOrEqual(7);
  });
  it("drops a label that would sit right next to the final one", () => {
    expect(labelIndexes(10, 6)).toEqual([0, 2, 4, 6, 9]);
  });
  it("handles empty input", () => {
    expect(labelIndexes(0, 6)).toEqual([]);
  });
});
