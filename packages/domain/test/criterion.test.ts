import { describe, expect, it } from "vitest";
import { criterionSymbol, evaluateCriterion, formatCriterion, parseCriterion } from "../src/criterion.ts";

describe("parsing a criterion", () => {
  it("reads the simple SYMBOL comparator VALUE form", () => {
    expect(parseCriterion("BTCUSDT > 100000")).toEqual({ symbol: "BTCUSDT", comparator: ">", value: 100000 });
  });

  // The alternation has to try ">=" before ">", or the ">" branch matches and
  // leaves an "=" that fails the number.
  it("does not truncate a two-character comparator", () => {
    expect(parseCriterion("SPX >= 6000")?.comparator).toBe(">=");
    expect(parseCriterion("SPX <= 6000")?.comparator).toBe("<=");
    expect(parseCriterion("SPX != 6000")?.comparator).toBe("!=");
  });

  it("treats a single = as equality, because that is how people write it", () => {
    expect(parseCriterion("USDKRW = 1400")?.comparator).toBe("==");
  });

  it("accepts the separators real tickers carry", () => {
    expect(parseCriterion("035420.KS > 90000")?.symbol).toBe("035420.KS");
    expect(parseCriterion("BRK-B > 500")?.symbol).toBe("BRK-B");
    expect(parseCriterion("BTC/USD > 90000")?.symbol).toBe("BTC/USD");
    expect(parseCriterion("^SOX > 6000")?.symbol).toBe("^SOX");
  });

  it("accepts thousands separators in the level", () => {
    expect(parseCriterion("KOSPI > 3,000")?.value).toBe(3000);
  });

  it("normalises the symbol so a lowercase call resolves against the same quote", () => {
    expect(parseCriterion("btcusdt > 1")?.symbol).toBe("BTCUSDT");
  });

  it("reads a negative level, which a spread or a flow number can be", () => {
    expect(parseCriterion("KOSPI_FOREIGN_NET < -10000")?.value).toBe(-10000);
  });

  // Prose is a valid criterion as long as a human resolves it. Null is the
  // signal to leave the row alone, not a parse failure to report.
  it("returns null for prose rather than guessing at it", () => {
    expect(parseCriterion("the Fed cuts before September")).toBeNull();
    expect(parseCriterion("BTCUSDT")).toBeNull();
    expect(parseCriterion("BTCUSDT >")).toBeNull();
    expect(parseCriterion("")).toBeNull();
  });
});

describe("evaluating a criterion", () => {
  it("compares the observation against the level in the stated direction", () => {
    const above = { symbol: "BTCUSDT", comparator: ">", value: 100000 } as const;
    expect(evaluateCriterion(above, 100001)).toBe(true);
    expect(evaluateCriterion(above, 100000)).toBe(false);

    const below = { symbol: "BTCUSDT", comparator: "<=", value: 100000 } as const;
    expect(evaluateCriterion(below, 100000)).toBe(true);
    expect(evaluateCriterion(below, 100001)).toBe(false);
  });

  it("round-trips through its printed form", () => {
    const parsed = parseCriterion("KOSPI >= 3,000");
    expect(parsed).not.toBeNull();
    if (parsed) expect(formatCriterion(parsed)).toBe("KOSPI >= 3000");
  });

  it("names the symbol a resolver has to fetch, or nothing for prose", () => {
    expect(criterionSymbol("BTCUSDT > 100000")).toBe("BTCUSDT");
    expect(criterionSymbol("rates come down")).toBeNull();
  });
});
