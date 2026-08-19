import { describe, expect, it } from "vitest";
import { COT_MARKETS, COT_SOURCE, COT_UNIT, fetchCotFlows, flowRowsFrom, reportDay } from "../src/flows/cot.ts";

// One week of E-mini S&P 500, in the shape Socrata answers with: every value a
// string, and the report date an instant even though it is a date.
const WEEK = {
  report_date_as_yyyy_mm_dd: "2026-08-11T00:00:00.000",
  open_interest_all: "2119506",
  change_in_noncomm_long_all: "9156",
  change_in_noncomm_short_all: "-29382",
  change_in_comm_long_all: "-21101",
  change_in_comm_short_all: "36963",
  change_in_nonrept_long_all: "7075",
  change_in_nonrept_short_all: "-12451",
};

describe("reading a COT report", () => {
  it("keeps the report date a date", () => {
    expect(reportDay("2026-08-11T00:00:00.000")).toBe("2026-08-11");
  });

  it("records the change in net position, not the level", () => {
    const rows = flowRowsFrom("ES", [WEEK]);
    const byType = Object.fromEntries(rows.map((r) => [r.investorType, r.netBuyValue]));
    // Long change minus short change. The large speculators covered 29,382
    // shorts and added 9,156 longs, which is one number, not two.
    expect(byType.institution).toBe(9156 - -29382);
    expect(byType.other).toBe(-21101 - 36963);
    expect(byType.retail).toBe(7075 - -12451);
  });

  // COT reports what a participant is, not where it is, so the residency
  // category the flows vocabulary carries for other markets never appears.
  it("never claims to know a participant's residency", () => {
    expect(flowRowsFrom("ES", [WEEK]).some((r) => r.investorType === "foreign")).toBe(false);
  });

  // A hedger is not a small institution. Flattening commercials into
  // "institution" would merge the two sides the report exists to separate.
  it("keeps hedgers apart from the funds", () => {
    const rows = flowRowsFrom("ES", [WEEK]);
    expect(rows.find((r) => r.investorType === "other")?.netBuyValue).toBeLessThan(0);
    expect(rows.find((r) => r.investorType === "institution")?.netBuyValue).toBeGreaterThan(0);
  });

  // Contracts, said out loud on the row. A notional would need a multiplier and
  // a settlement price per market per week, and would be an estimate wearing a
  // fact's clothes.
  it("says the unit is contracts rather than implying money", () => {
    for (const row of flowRowsFrom("ES", [WEEK])) {
      expect(row.currency).toBe(COT_UNIT);
      expect(row.source).toBe(COT_SOURCE);
      expect(row.turnoverValue).toBe(2119506);
    }
  });

  // A week with no published change is not a week nobody moved.
  it("skips a class whose change the report did not carry", () => {
    const partial = { ...WEEK, change_in_nonrept_long_all: undefined };
    expect(flowRowsFrom("ES", [partial]).some((r) => r.investorType === "retail")).toBe(false);
  });
});

describe("the market list", () => {
  // A wrong contract code returns another market's positioning without
  // erroring, so the codes are read off the endpoint rather than remembered.
  it("carries a unique code and label per market", () => {
    const codes = new Set(COT_MARKETS.map((m) => m.code));
    const markets = new Set(COT_MARKETS.map((m) => m.market));
    expect(codes.size).toBe(COT_MARKETS.length);
    expect(markets.size).toBe(COT_MARKETS.length);
  });
});

describe("fetching", () => {
  function stub(body: unknown, ok = true): typeof fetch {
    const impl = async () => ({ ok, status: ok ? 200 : 503, json: async () => body });
    return impl as unknown as typeof fetch;
  }

  it("asks for one market and turns its weeks into rows", async () => {
    const rows = await fetchCotFlows({
      fetchImpl: stub([WEEK]),
      markets: [{ code: "13874A", market: "ES", label: "E-mini S&P 500" }],
    });
    expect(rows).toHaveLength(3);
    expect(rows[0].market).toBe("ES");
  });

  // Silence would leave a market quietly missing from a series that gets read
  // as complete.
  it("names the market whose code returned nothing", async () => {
    await expect(
      fetchCotFlows({ fetchImpl: stub([]), markets: [{ code: "000000", market: "ZZ", label: "gone" }] }),
    ).rejects.toThrow(/no report for ZZ \(000000\)/);
  });

  it("names the market when the endpoint is down", async () => {
    await expect(
      fetchCotFlows({ fetchImpl: stub([], false), markets: [{ code: "13874A", market: "ES", label: "x" }] }),
    ).rejects.toThrow(/cftc 503 for ES/);
  });
});
