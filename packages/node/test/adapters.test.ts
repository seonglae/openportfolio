import { describe, expect, it } from "vitest";
import { UNSUPPORTED_CAPABILITY } from "@openportfolio/domain";
import { coingeckoId, createCoingeckoAdapter, stripQuoteSuffix } from "../src/adapters/coingecko.ts";
import { createManualAdapter, parseManualHoldings, type ManualHolding } from "../src/adapters/manual.ts";
import { balancesThrough, createAdapterRegistry, defaultRegistry, quoteThrough } from "../src/adapters/registry.ts";

const LAST_UPDATED_SEC = 1_786_114_770;

function stubFetch(body: unknown, ok = true): typeof fetch {
  const impl = async () => ({ ok, status: ok ? 200 : 500, json: async () => body });
  return impl as unknown as typeof fetch;
}

describe("mapping a ticker to a CoinGecko id", () => {
  it("drops the quote-currency suffix an exchange glued on", () => {
    expect(stripQuoteSuffix("BTCUSDT")).toBe("BTC");
    expect(stripQuoteSuffix("ETHKRW")).toBe("ETH");
    // Longest suffix first, or "BTCUSDT" would lose "USD" and keep a stray T.
    expect(stripQuoteSuffix("BTCUSDC")).toBe("BTC");
  });

  it("does not eat a symbol that is only a currency name", () => {
    expect(stripQuoteSuffix("USD")).toBe("USD");
  });

  // The ids and the tickers disagree exactly where it hurts: `eth` is not
  // ethereum on CoinGecko.
  it("aliases the majors and passes anything else through as an id", () => {
    expect(coingeckoId("BTC")).toBe("bitcoin");
    expect(coingeckoId("ethusdt")).toBe("ethereum");
    expect(coingeckoId("render-token")).toBe("render-token");
  });
});

describe("the CoinGecko adapter", () => {
  it("reads a quote and reports the venue's own timestamp", async () => {
    const adapter = createCoingeckoAdapter({
      fetchImpl: stubFetch({ bitcoin: { usd: 64933, last_updated_at: LAST_UPDATED_SEC } }),
    });
    const quote = await adapter.readQuote({ symbol: "BTCUSDT" });
    expect(quote.price).toBe(64933);
    expect(quote.currency).toBe("USD");
    // Our own clock here would let a stale quote claim to be fresh.
    expect(quote.asOf).toBe(LAST_UPDATED_SEC * 1000);
  });

  it("honours a requested quote currency", async () => {
    const adapter = createCoingeckoAdapter({ fetchImpl: stubFetch({ bitcoin: { krw: 91_547_896 } }) });
    const quote = await adapter.readQuote({ symbol: "BTC", currency: "KRW" });
    expect(quote.price).toBe(91_547_896);
    expect(quote.currency).toBe("KRW");
  });

  it("names the coin it could not find instead of returning zero", async () => {
    const adapter = createCoingeckoAdapter({ fetchImpl: stubFetch({}) });
    await expect(adapter.readQuote({ symbol: "nope-coin" })).rejects.toThrow(/no coin "nope-coin"/);
  });

  // Returning [] would read as "you hold nothing", which is a wrong net worth
  // rather than a missing one.
  it("refuses to answer for balances it cannot know", async () => {
    const adapter = createCoingeckoAdapter({ fetchImpl: stubFetch({}) });
    await expect(adapter.readBalances({ accountKey: "any" })).rejects.toMatchObject({
      code: UNSUPPORTED_CAPABILITY,
    });
  });
});

const HOLDINGS: ManualHolding[] = [
  { accountKey: "isa", symbol: "035420.KS", assetClass: "equity", qty: 100, price: 90_000, currency: "KRW" },
  {
    accountKey: "isa",
    symbol: "PENSION",
    assetClass: "other",
    qty: 1,
    price: 12_000_000,
    currency: "KRW",
    costBasis: 10_000_000,
  },
  { accountKey: "other", symbol: "VWRL", assetClass: "etf", qty: 10, price: 120, currency: "GBP" },
];

describe("the manual adapter", () => {
  it("returns only the account it was asked about", async () => {
    const adapter = createManualAdapter({ rows: HOLDINGS });
    const rows = await adapter.readBalances({ accountKey: "isa" });
    expect(rows.map((r) => r.symbol)).toEqual(["035420.KS", "PENSION"]);
  });

  it("values a row and derives pnl only where a cost basis exists", async () => {
    const adapter = createManualAdapter({ rows: HOLDINGS });
    const rows = await adapter.readBalances({ accountKey: "isa" });
    expect(rows[0].valueLocal).toBe(9_000_000);
    expect(rows[0].pnl).toBeUndefined();
    expect(rows[1].pnl).toBe(2_000_000);
  });

  it("quotes from the operator's own recorded price", async () => {
    const adapter = createManualAdapter({ rows: HOLDINGS, defaultAsOf: 42 });
    const quote = await adapter.readQuote({ symbol: "vwrl" });
    expect(quote.price).toBe(120);
    expect(quote.asOf).toBe(42);
  });
});

describe("parsing a manual holdings file", () => {
  it("names the row and the field that is wrong", () => {
    expect(() => parseManualHoldings('[{"accountKey":"a"}]')).toThrow(/row 0 is missing "symbol"/);
    expect(() => parseManualHoldings("{}")).toThrow(/must contain a JSON array/);
  });

  // A typo reaching the aggregate as `undefined * price` produces a NaN net
  // worth, which is far harder to trace than a parse error naming the row.
  it("rejects a non-numeric quantity before it can poison an aggregate", () => {
    const text = '[{"accountKey":"a","symbol":"S","assetClass":"equity","qty":"ten","price":1,"currency":"USD"}]';
    expect(() => parseManualHoldings(text)).toThrow(/row 0: bad qty/);
  });

  it("accepts a well-formed row", () => {
    const text = '[{"accountKey":"a","symbol":"S","assetClass":"equity","qty":2,"price":3,"currency":"USD"}]';
    expect(parseManualHoldings(text)[0].qty).toBe(2);
  });
});

describe("the registry", () => {
  it("lists what it knows when asked for something it does not", () => {
    const registry = createAdapterRegistry([createManualAdapter({ rows: [] })]);
    expect(() => registry.get("toss")).toThrow(/no adapter for venue "toss" \(registered: manual\)/);
  });

  it("ships only the keyless quote source by default", () => {
    expect(defaultRegistry().venues()).toEqual(["coingecko"]);
  });

  it("reports each adapter's capabilities so the backend need not keep a copy", () => {
    const registry = createAdapterRegistry([createManualAdapter({ rows: HOLDINGS })]);
    expect(registry.capabilities()).toEqual([
      { venue: "manual", kind: "manual", canReadBalances: true, canReadQuotes: true, canPlaceOrders: false },
    ]);
  });

  it("checks the capability before dispatching, not after", async () => {
    const registry = createAdapterRegistry([
      createCoingeckoAdapter({ fetchImpl: stubFetch({ bitcoin: { usd: 1 } }) }),
      createManualAdapter({ rows: HOLDINGS }),
    ]);
    await expect(balancesThrough(registry, "coingecko", "isa")).rejects.toThrow(/does not support canReadBalances/);
    await expect(quoteThrough(registry, "coingecko", "BTC")).resolves.toMatchObject({ price: 1 });
  });
});
