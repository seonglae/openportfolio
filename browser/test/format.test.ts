import { describe, expect, it } from "vitest";
import { formatBrier, formatMoney, formatPercent, formatRelativeDays } from "../src/lib/format.ts";

describe("money", () => {
  // "₩91,547,896.00" is not more precise, it is wrong about what a won is.
  it("drops the minor unit for a currency that has none", () => {
    expect(formatMoney(91_547_896, "KRW")).not.toContain(".");
    expect(formatMoney(1234.5, "USD")).toContain(".50");
  });

  // A manual account can hold a made-up code, and Intl throws on one.
  it("degrades to a plain number for a currency Intl does not know", () => {
    expect(formatMoney(10, "XYZ123")).toBe("10.00 XYZ123");
  });

  it("shows a dash rather than NaN", () => {
    expect(formatMoney(Number.NaN, "USD")).toBe("-");
  });
});

describe("scores and shares", () => {
  it("says a record is unscored instead of printing a zero that reads as perfect", () => {
    expect(formatBrier(null)).toBe("not scored yet");
    expect(formatBrier(0.25)).toBe("0.250");
  });

  it("renders a fraction as a percentage, and nothing for an undefined share", () => {
    expect(formatPercent(0.253)).toBe("25.3%");
    expect(formatPercent(null)).toBe("-");
  });
});

describe("waiting time", () => {
  const now = Date.UTC(2026, 0, 10);
  it("counts forward and backward from today", () => {
    expect(formatRelativeDays(now, now)).toBe("today");
    expect(formatRelativeDays(Date.UTC(2026, 0, 13), now)).toBe("in 3d");
    expect(formatRelativeDays(Date.UTC(2026, 0, 4), now)).toBe("6d ago");
  });
});
