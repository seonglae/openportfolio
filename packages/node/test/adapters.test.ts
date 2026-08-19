import { describe, expect, it } from "vitest";
import { UNSUPPORTED_CAPABILITY } from "@openportfolio/domain";
import { coingeckoId, createCoingeckoAdapter, stripQuoteSuffix } from "../src/adapters/coingecko.ts";
import { createManualAdapter, parseManualHoldings, type ManualHolding } from "../src/adapters/manual.ts";
import { createYahooAdapter, toMajorUnit } from "../src/adapters/yahoo.ts";
import {
  balancesThrough,
  createAdapterRegistry,
  defaultRegistry,
  pricesOwnBalances,
  quoteSymbolFor,
  quoteThrough,
  quoteVenueFor,
} from "../src/adapters/registry.ts";

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

  it("ships only the keyless quote sources by default", () => {
    expect(defaultRegistry().venues()).toEqual(["coingecko", "yahoo"]);
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

// A chart response, trimmed to the fields the adapter reads.
function stubChart(meta: Record<string, unknown>, ok = true): typeof fetch {
  const impl = async () => ({ ok, status: ok ? 200 : 404, json: async () => ({ chart: { result: [{ meta }] } }) });
  return impl as unknown as typeof fetch;
}

const MARKET_TIME_SEC = 1_787_161_202;

describe("the Yahoo adapter", () => {
  it("reads a quote and reports the exchange's own timestamp", async () => {
    const adapter = createYahooAdapter({
      fetchImpl: stubChart({ symbol: "NVDA", regularMarketPrice: 218.919, currency: "USD", regularMarketTime: MARKET_TIME_SEC }),
    });
    const quote = await adapter.readQuote({ symbol: "NVDA" });
    expect(quote).toEqual({ symbol: "NVDA", price: 218.919, currency: "USD", asOf: MARKET_TIME_SEC * 1000 });
  });

  // LSE ordinaries come back as "GBp" at 110.35 while the ETF beside them comes
  // back as "GBP" at 138.24. Uppercasing the code makes every UK share a
  // hundred times itself, and the total still looks plausible enough to act on.
  it("converts a price quoted in a minor unit instead of relabelling it", async () => {
    const adapter = createYahooAdapter({
      fetchImpl: stubChart({ symbol: "LLOY.L", regularMarketPrice: 110.35, currency: "GBp", regularMarketTime: MARKET_TIME_SEC }),
    });
    const quote = await adapter.readQuote({ symbol: "LLOY.L" });
    expect(quote.price).toBeCloseTo(1.1035, 6);
    expect(quote.currency).toBe("GBP");
  });

  it("leaves a major-unit price alone", () => {
    expect(toMajorUnit(138.24, "GBP")).toEqual({ price: 138.24, currency: "GBP" });
    expect(toMajorUnit(247_500, "krw")).toEqual({ price: 247_500, currency: "KRW" });
  });

  it("reports the listing currency rather than the one that was asked for", async () => {
    const adapter = createYahooAdapter({
      fetchImpl: stubChart({ symbol: "005930.KS", regularMarketPrice: 247_500, currency: "KRW", regularMarketTime: MARKET_TIME_SEC }),
    });
    // Relabelling a KRW number as GBP is how 247,500 won reaches a total as
    // 247,500 pounds. It cannot convert, so it says what it has.
    const quote = await adapter.readQuote({ symbol: "005930.KS", currency: "GBP" });
    expect(quote.currency).toBe("KRW");
  });

  it("names the symbol it could not price", async () => {
    const impl = async () => ({
      ok: false,
      status: 404,
      json: async () => ({ chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } }),
    });
    const adapter = createYahooAdapter({ fetchImpl: impl as unknown as typeof fetch });
    await expect(adapter.readQuote({ symbol: "ZZZNOTREAL" })).rejects.toThrow(/No data found.*ZZZNOTREAL/);
  });

  it("refuses to enumerate holdings rather than returning none", async () => {
    const adapter = createYahooAdapter({ fetchImpl: stubChart({}) });
    await expect(adapter.readBalances({ accountKey: "isa" })).rejects.toMatchObject({ code: UNSUPPORTED_CAPABILITY });
  });
});

describe("routing a quote to the venue that can price it", () => {
  const registry = defaultRegistry();

  it("sends listed instruments to Yahoo and coins to CoinGecko", () => {
    expect(quoteVenueFor(registry, "equity")).toBe("yahoo");
    expect(quoteVenueFor(registry, "etf")).toBe("yahoo");
    expect(quoteVenueFor(registry, "bond")).toBe("yahoo");
    expect(quoteVenueFor(registry, "crypto")).toBe("coingecko");
  });

  // Cash is converted by the FX rates, not quoted, and "other" is the class
  // that says we do not know what this is. Null means leave the stored price.
  it("declines to price a class no quote source should be asked about", () => {
    expect(quoteVenueFor(registry, "cash")).toBeNull();
    expect(quoteVenueFor(registry, "other")).toBeNull();
  });

  it("honours the operator's pin over the class route", () => {
    expect(quoteVenueFor(registry, "equity", "coingecko")).toBe("coingecko");
  });

  it("returns null for a venue that is pinned but not registered", () => {
    expect(quoteVenueFor(registry, "equity", "ibkr")).toBeNull();
  });

  // Both sources answer the wrong instrument with a 200: Yahoo prices "BTC" as
  // a Grayscale ETF near $30, CoinGecko has an "aapl" token worth 18 cents.
  // Which is why nothing falls back to the other venue, and why a coin sent to
  // Yahoo has to be asked for as a pair.
  it("asks Yahoo for a coin by its quote pair, and leaves every other case alone", () => {
    expect(quoteSymbolFor("yahoo", "BTC", "crypto")).toBe("BTC-USD");
    expect(quoteSymbolFor("yahoo", "BTC-USD", "crypto")).toBe("BTC-USD");
    expect(quoteSymbolFor("coingecko", "BTC", "crypto")).toBe("BTC");
    expect(quoteSymbolFor("yahoo", "NVDA", "equity")).toBe("NVDA");
  });
});

describe("deciding whether a row needs a second price", () => {
  // The bug this pins: `manual` declares canReadQuotes because readQuote works,
  // and a worker that read that flag as "already priced" skipped every manual
  // row. Since manual is the only venue that ships holdings, that made both
  // keyless quote sources unreachable and left the documented quickstart with a
  // bitcoin row still valued at the 0 the file was seeded with.
  it("does not treat the operator's own typed price as a market price", () => {
    expect(pricesOwnBalances(createManualAdapter({ rows: HOLDINGS }))).toBe(false);
  });

  it("leaves a real quote source alone", () => {
    expect(pricesOwnBalances(createCoingeckoAdapter())).toBe(true);
    expect(pricesOwnBalances(createYahooAdapter())).toBe(true);
  });
});
