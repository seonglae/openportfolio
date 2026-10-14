// These exact eight assertions run against both 8b7765f and the PR head.
// Synthetic provider payloads only; no accounts or network calls.
import { describe, expect, it } from "vitest";
import { createCoingeckoAdapter } from "../src/adapters/coingecko.ts";
import { createYahooAdapter } from "../src/adapters/yahoo.ts";
import { flowRowsFrom } from "../src/flows/cot.ts";
import { resolveFromObservation, validateForecast } from "../../domain/src/forecast.ts";

const stub = (body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body))) as typeof fetch;
const WEEK = {
  report_date_as_yyyy_mm_dd: "2026-01-06",
  open_interest_all: "1000",
  change_in_nonrept_long_all: "30",
  change_in_nonrept_short_all: "10",
};
describe("baseline-comparable semantic regressions", () => {
  it("does not invent CoinGecko quote time", async () => {
    await expect(
      createCoingeckoAdapter({ fetchImpl: stub({ bitcoin: { usd: 100 } }) }).readQuote({ symbol: "BTC" }),
    ).rejects.toThrow();
  });
  it("does not invent Yahoo quote time", async () => {
    await expect(
      createYahooAdapter({
        fetchImpl: stub({
          chart: { result: [{ meta: { symbol: "AAPL", currency: "USD", regularMarketPrice: 100 } }] },
        }),
      }).readQuote({ symbol: "AAPL" }),
    ).rejects.toThrow();
  });
  it("does not invent Yahoo quote currency", async () => {
    await expect(
      createYahooAdapter({
        fetchImpl: stub({
          chart: { result: [{ meta: { symbol: "AAPL", regularMarketTime: 1767225600, regularMarketPrice: 100 } }] },
        }),
      }).readQuote({ symbol: "AAPL" }),
    ).rejects.toThrow();
  });
  it("does not accept the wrong Yahoo listing", async () => {
    await expect(
      createYahooAdapter({
        fetchImpl: stub({
          chart: {
            result: [
              { meta: { symbol: "AAPL", currency: "USD", regularMarketTime: 1767225600, regularMarketPrice: 100 } },
            ],
          },
        }),
      }).readQuote({ symbol: "MSFT" }),
    ).rejects.toThrow();
  });
  it("does not call non-reportable traders retail", () => {
    expect(flowRowsFrom("ES", [WEEK])[0].investorType).toBe("non_reportable");
  });
  it("does not call open interest turnover", () => {
    expect(flowRowsFrom("ES", [WEEK])[0]).not.toHaveProperty("turnoverValue");
  });
  it("does not score an infinite observation", () => {
    expect(resolveFromObservation(0.8, "BTC > 1", Infinity)).toBeNull();
  });
  it("does not register a NaN horizon", () => {
    expect(
      validateForecast({ subject: "x", probability: 0.5, horizonSec: NaN, resolutionCriterion: "X > 1" }).length,
    ).toBeGreaterThan(0);
  });
});
