import { describe, expect, it } from "vitest";
import { percentChange, roundTo, sumBy, toBaseCurrency, weight } from "../src/money.ts";

describe("rounding money", () => {
  // Math.round breaks ties toward +Infinity. A portfolio that nets a gain
  // against a loss of the same size would come out non-zero, which is the kind
  // of cent that people notice and nobody can explain.
  it("rounds a tie away from zero in both directions", () => {
    expect(roundTo(0.125, 2)).toBe(0.13);
    expect(roundTo(-0.125, 2)).toBe(-0.13);
  });

  it("keeps a scale the caller asks for, because KRW has no minor unit", () => {
    expect(roundTo(1234.56, 0)).toBe(1235);
    expect(roundTo(0.123456789, 8)).toBe(0.12345679);
  });

  it("passes a non-finite value through instead of inventing a number", () => {
    expect(roundTo(Number.NaN)).toBeNaN();
    expect(roundTo(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("aggregating", () => {
  it("skips non-finite rows so one bad quote cannot void a net worth", () => {
    const rows = [{ v: 10 }, { v: Number.NaN }, { v: 5 }];
    expect(sumBy(rows, (r) => r.v)).toBe(15);
  });

  it("converts with an identity rate for a same-currency row", () => {
    expect(toBaseCurrency(120, 1)).toBe(120);
    expect(toBaseCurrency(100, 0.79)).toBe(79);
  });
});

describe("relative measures", () => {
  it("reports null rather than Infinity when there is no base to compare to", () => {
    expect(percentChange(0, 100)).toBeNull();
    expect(weight(10, 0)).toBeNull();
  });

  it("measures a loss against the absolute base, so a short is not inverted", () => {
    expect(percentChange(-100, -50)).toBe(50);
  });

  it("returns a fraction, not a percentage, for a weight", () => {
    expect(weight(25, 100)).toBe(0.25);
  });
});
