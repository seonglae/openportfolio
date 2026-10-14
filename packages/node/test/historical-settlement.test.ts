import { describe, expect, it, vi } from "vitest";
import { type ResolutionTarget, validateEvidence } from "@openportfolio/domain";
import { createYahooAdapter } from "../src/adapters/yahoo.ts";
import { createCoingeckoAdapter } from "../src/adapters/coingecko.ts";
import { createAdapterRegistry } from "../src/adapters/registry.ts";
import { settleHistoricalForecasts } from "../src/settlement.ts";

const MINUTE = 60000;
const DUE = Date.UTC(2026, 0, 2, 16, 1, 30);
const LAST_END = Date.UTC(2026, 0, 2, 16, 1);
const TARGET: ResolutionTarget = {
  assetId: "yahoo:AAPL",
  symbol: "AAPL",
  venue: "yahoo",
  currency: "USD",
  assetClass: "equity",
  observationPolicy: "last_completed_minute",
  priceBasis: "provider_close",
  sessions: "all",
  maxAgeMs: 2 * MINUTE,
};
const META = { symbol: "AAPL", instrumentType: "EQUITY", currency: "USD", dataGranularity: "1m" };
const BARS = [LAST_END - MINUTE, LAST_END, LAST_END + MINUTE];
function payload(ends = BARS, prices: Array<number | null> = [99, 101, 900], meta = META) {
  return {
    chart: {
      result: [
        { meta, timestamp: ends.map((end) => (end - MINUTE) / 1000), indicators: { quote: [{ close: prices }] } },
      ],
    },
  };
}
const stub = (body: unknown) =>
  vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response(JSON.stringify(body)));
function adapter(body = payload()) {
  return createYahooAdapter({ fetchImpl: stub(body) });
}
async function read(body = payload(), target = TARGET) {
  const source = adapter(body);
  if (!source.readHistoricalQuote) throw new Error("historical capability missing");
  return source.readHistoricalQuote({ target, dueAt: DUE });
}

describe("Yahoo precommitted historical policy", () => {
  it("uses the last completed minute, not the later live quote or a partial bar", async () => {
    const quote = await read();
    expect(quote.price).toBe(101);
    expect(quote.evidence.observedAt).toBe(LAST_END);
    expect(quote.evidence.assetId).toBe("yahoo:AAPL");
    expect(quote.evidence.source).toContain("interval=1m");
    expect(quote.evidence.source).toContain("includePrePost=true");
    expect(() => validateEvidence(TARGET, quote.evidence, DUE, DUE + 1)).not.toThrow();
  });
  it("requests the complete committed window without widening it after outcomes", async () => {
    const fetchImpl = stub(payload());
    const source = createYahooAdapter({ fetchImpl });
    await source.readHistoricalQuote?.({ target: TARGET, dueAt: DUE });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.get("period1")).toBe(String((DUE - 3 * MINUTE) / 1000));
    expect(url.searchParams.get("period2")).toBe(String(DUE / 1000));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("makes the same choice for out-of-order bars and skips missing closes", async () => {
    expect((await read(payload([LAST_END + MINUTE, LAST_END, LAST_END - MINUTE], [900, 101, 99]))).price).toBe(101);
    expect((await read(payload(BARS, [99, null, 900]))).price).toBe(99);
  });
  it("keeps closed-market calls pending unless the age was explicitly registered", async () => {
    const fridayClose = LAST_END - 3 * 86400000;
    await expect(read(payload([fridayClose], [101]))).rejects.toThrow(/no completed minute/);
    const weekendTarget = { ...TARGET, maxAgeMs: 4 * 86400000 };
    expect((await read(payload([fridayClose], [101]), weekendTarget)).evidence.observedAt).toBe(fridayClose);
  });
  it.each([{ symbol: "MSFT" }, { instrumentType: "CRYPTOCURRENCY" }, { currency: "GBP" }, { dataGranularity: "1d" }])(
    "rejects provider identity or currency drift %j",
    async (change) => {
      await expect(read(payload(BARS, [99, 101, 900], { ...META, ...change }))).rejects.toThrow(/mismatch/);
    },
  );
  it("normalizes minor units with their currency rather than relabeling the price", async () => {
    expect(
      (await read(payload(BARS, [9900, 10100, 90000], { ...META, currency: "GBp" }), { ...TARGET, currency: "GBP" }))
        .price,
    ).toBe(101);
  });
  it.each([
    payload([LAST_END, LAST_END], [99, 101]),
    payload([LAST_END], []),
    payload([LAST_END + 1], [101]),
    payload([LAST_END + MINUTE], [900]),
  ])("refuses unusable historical series", async (body) => {
    await expect(read(body)).rejects.toThrow();
  });
  it("refuses arbitrary provider IDs, unsupported assets and unbounded policies", async () => {
    for (const target of [
      { ...TARGET, assetId: "coingecko:aapl" },
      { ...TARGET, assetClass: "crypto" as const },
      { ...TARGET, maxAgeMs: 5 * 86400000 },
      { ...TARGET, observationPolicy: "exact" as const },
    ]) {
      await expect(read(payload(), target)).rejects.toThrow();
    }
  });
});

describe("worker historical settlement", () => {
  const due = { id: "forecast-1", subject: "Apple", probability: 0.8, dueAt: DUE, resolutionTarget: TARGET };
  it("submits only source-bound historical evidence and preserves the result", async () => {
    const settle = vi.fn(async (_input: unknown) => ({ outcome: true, brier: 0.04 }));
    const pending = vi.fn();
    const result = await settleHistoricalForecasts(
      createAdapterRegistry([adapter()]),
      [due],
      settle,
      pending,
      DUE + MINUTE,
    );
    expect(result).toEqual([{ subject: "Apple", probability: 0.8, outcome: true, brier: 0.04 }]);
    expect(settle.mock.calls[0]?.[0]).toMatchObject({
      forecastId: due.id,
      observedValue: 101,
      evidence: { observedAt: LAST_END, assetId: "yahoo:AAPL" },
    });
    expect(pending).not.toHaveBeenCalled();
  });
  it("never falls back to a live or CoinGecko quote for AAPL", async () => {
    const coinFetch = vi.fn();
    const registry = createAdapterRegistry([createCoingeckoAdapter({ fetchImpl: coinFetch })]);
    const settle = vi.fn();
    const pending = vi.fn();
    await settleHistoricalForecasts(
      registry,
      [
        { ...due, resolutionTarget: undefined },
        { ...due, resolutionTarget: { ...TARGET, venue: "coingecko" } },
      ],
      settle,
      pending,
      DUE,
    );
    expect(settle).not.toHaveBeenCalled();
    expect(coinFetch).not.toHaveBeenCalled();
    expect(pending).toHaveBeenCalledTimes(2);
  });
  it("leaves provider failures pending and keeps processing later calls", async () => {
    const settle = vi.fn(async (_input: unknown) => ({ outcome: true, brier: 0.04 }));
    const pending = vi.fn();
    const result = await settleHistoricalForecasts(
      createAdapterRegistry([adapter()]),
      [{ ...due, resolutionTarget: { ...TARGET, currency: "GBP" } }, due],
      settle,
      pending,
      DUE,
    );
    expect(result).toHaveLength(1);
    expect(pending).toHaveBeenCalledTimes(1);
  });
});

describe("provider price basis and session scope", () => {
  it("uses quote.close rather than adjclose and persists parsed-payload provenance", async () => {
    const body = {
      chart: {
        result: [
          {
            meta: META,
            timestamp: [(LAST_END - MINUTE) / 1000],
            indicators: { quote: [{ close: [101] }], adjclose: [{ adjclose: [50.5] }] },
          },
        ],
      },
    };
    const quote = await read(body);
    expect(quote.price).toBe(101);
    expect(quote.evidence).toMatchObject({
      priceBasis: "provider_close",
      sessions: "all",
      parsedResponseSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      retrievedAt: expect.any(Number),
    });
  });
  it("includes a completed extended-hours bar under the explicit all-session policy", async () => {
    const body = payload([LAST_END - MINUTE, LAST_END], [99, 101]);
    expect((await read(body)).price).toBe(101);
    expect(TARGET.sessions).toBe("all");
  });
});
