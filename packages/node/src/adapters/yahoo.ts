// Global quotes, keyless: Yahoo's chart endpoint.
//
// CoinGecko covers coins and nothing else, so before this adapter a share, an
// ETF or a fund kept whatever price was typed into the manual holdings file and
// the equity half of a net worth quietly stopped moving. This one prices
// anything Yahoo lists: US, LSE, KRX, TSE, XETRA, plus FX pairs and indices,
// in whatever currency the listing trades in.
//
// Quotes only. It has no idea what you hold, and says so through its
// capabilities rather than returning an empty balance list that would read as
// "you hold nothing".
//
// The symbol is sent exactly as given. That is a deliberate refusal, not a gap:
// Yahoo answers "BTC" with the Grayscale Bitcoin Mini Trust at about $30 rather
// than bitcoin at about $68,000, and it answers with an HTTP 200. An adapter
// that guessed a suffix would turn a bitcoin position into a rounding error on
// the total, which is a wrong net worth rather than a missing one. Whoever
// knows the asset class does the mapping; see `quoteVenueFor` in registry.ts.

import { createHash } from "node:crypto";

import {
  MINUTE_MS,
  MAX_OBSERVATION_AGE_MS,
  type HistoricalQuote,
  type HistoricalQuoteRequest,
  type AdapterBalance,
  type AdapterQuote,
  type ReadQuoteRequest,
  type VenueAdapter,
  unsupportedCapability,
} from "@openportfolio/domain";

export const YAHOO_VENUE = "yahoo";
const DEFAULT_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const DEFAULT_TIMEOUT_MS = 10_000;
const MS_PER_SEC = 1000;

// A request with no User-Agent is answered 429 rather than 200, on the first
// call, from a clean IP. This is the whole "auth" the endpoint has.
const USER_AGENT = "Mozilla/5.0 (compatible; openportfolio/0.1; +https://openportfolio.app)";

// Exchanges that quote in a minor unit, and Yahoo reports the minor code rather
// than converting: LSE ordinaries come back as "GBp" at 110.35 while the ETF
// next to them comes back as "GBP" at 138.24. Uppercasing the code would turn
// every UK share into a hundred times itself, and the total would look right
// enough to act on. The case is the signal, so this is checked before any
// normalisation.
const MINOR_UNITS: Record<string, { major: string; per: number }> = {
  GBp: { major: "GBP", per: 100 }, // pence
  ZAc: { major: "ZAR", per: 100 }, // South African cents
  ILA: { major: "ILS", per: 100 }, // agorot
};

// Returns the price in the major unit and the ISO code that goes with it.
export function toMajorUnit(price: number, reported: string): { price: number; currency: string } {
  const minor = MINOR_UNITS[reported];
  if (!minor) return { price, currency: reported.toUpperCase() };
  return { price: price / minor.per, currency: minor.major };
}

export type YahooOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type ChartMeta = {
  symbol?: string;
  regularMarketPrice?: number;
  currency?: string;
  regularMarketTime?: number;
  instrumentType?: string;
  dataGranularity?: string;
};
type ChartResponse = {
  chart?: {
    result?: Array<{
      meta?: ChartMeta;
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
};

async function readChart(response: Response): Promise<ChartResponse | null> {
  // The single JSON boundary for current and historical chart responses.
  return (await response.json().catch(() => null)) as ChartResponse | null;
}

export function createYahooAdapter(opts: YahooOptions = {}): VenueAdapter {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function readQuote(request: ReadQuoteRequest): Promise<AdapterQuote> {
    const symbol = request.symbol.trim();
    if (!symbol) throw new Error("yahoo needs a symbol");
    const url = `${baseUrl}/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    const res = await doFetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // A delisted or misspelled symbol comes back 404 with the reason in the
    // body, so the body is read before the status is judged.
    const body = await readChart(res);
    const failure = body?.chart?.error;
    if (failure) throw new Error(`yahoo: ${failure.description ?? failure.code ?? "error"} for "${symbol}"`);
    if (!res.ok) throw new Error(`yahoo ${res.status} for "${symbol}"`);
    const meta = body?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error(`yahoo returned no result for "${symbol}"`);
    const price = meta.regularMarketPrice;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0)
      throw new Error(`yahoo has no price for "${symbol}"`);

    // The listing currency, which is the one the price is actually in. A request
    // that asked for another one gets told what it got instead of having a
    // number relabelled: converting is the caller's job, and it is the caller
    // that knows which rate it wants and when it was taken.
    if (!meta.currency) throw new Error(`yahoo has no currency for "${symbol}"`);
    if (meta.symbol?.toUpperCase() !== symbol.toUpperCase())
      throw new Error(`yahoo returned a different symbol for "${symbol}"`);
    const major = toMajorUnit(price, meta.currency);

    // The exchange's own timestamp. Our clock here would let Friday's close
    // claim to be a Sunday price.
    if (
      typeof meta.regularMarketTime !== "number" ||
      !Number.isFinite(meta.regularMarketTime) ||
      meta.regularMarketTime <= 0
    ) {
      throw new Error(`yahoo has no valid source timestamp for "${symbol}"`);
    }
    const asOf = meta.regularMarketTime * MS_PER_SEC;

    return { symbol: meta.symbol ?? symbol, price: major.price, currency: major.currency, asOf };
  }

  async function readHistoricalQuote(request: HistoricalQuoteRequest): Promise<HistoricalQuote> {
    const { target, dueAt } = request;
    if (
      target.venue !== YAHOO_VENUE ||
      target.assetId !== `yahoo:${target.symbol}` ||
      target.observationPolicy !== "last_completed_minute" ||
      target.priceBasis !== "provider_close" ||
      target.sessions !== "all" ||
      !Number.isFinite(dueAt) ||
      !target.maxAgeMs ||
      !Number.isInteger(target.maxAgeMs) ||
      target.maxAgeMs < MINUTE_MS ||
      target.maxAgeMs > MAX_OBSERVATION_AGE_MS
    ) {
      throw new Error("unsupported Yahoo historical resolution contract");
    }
    const instrumentTypes: Record<string, string> = { equity: "EQUITY", etf: "ETF" };
    const instrumentType = instrumentTypes[target.assetClass];
    if (!instrumentType) throw new Error("historical Yahoo supports equity and ETF only");
    // Request the entire precommitted window, never choose an outcome-dependent
    // retry window. Yahoo minute timestamps mark the bar's start, not its close.
    const params = new URLSearchParams({
      period1: String(Math.floor((dueAt - target.maxAgeMs - MINUTE_MS) / MS_PER_SEC)),
      period2: String(Math.ceil(dueAt / MS_PER_SEC)),
      interval: "1m",
      includePrePost: "true",
    });
    const source = `${baseUrl}/${encodeURIComponent(target.symbol)}?${params}`;
    const res = await doFetch(source, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await readChart(res);
    const result = body?.chart?.result?.[0];
    if (!res.ok || body?.chart?.error || !result) throw new Error("Yahoo historical evidence unavailable");
    const meta = result.meta;
    if (
      meta?.symbol !== target.symbol ||
      meta.instrumentType !== instrumentType ||
      meta.dataGranularity !== "1m" ||
      !meta.currency
    ) {
      throw new Error("Yahoo historical instrument identity mismatch");
    }
    const timestamps = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close;
    if (!timestamps || !closes || timestamps.length !== closes.length)
      throw new Error("Yahoo historical series is incomplete");
    const retrievedAt = Date.now();
    const parsedResponseSha256 = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    let chosen: HistoricalQuote | null = null;
    const seen = new Set<number>();
    for (const [index, startSec] of timestamps.entries()) {
      const observedAt = startSec * MS_PER_SEC + MINUTE_MS;
      if (!Number.isFinite(observedAt) || observedAt % MINUTE_MS !== 0 || seen.has(observedAt)) {
        throw new Error("Yahoo historical timestamps are invalid or duplicated");
      }
      seen.add(observedAt);
      if (observedAt > dueAt || dueAt - observedAt > target.maxAgeMs) continue;
      const close = closes[index];
      if (close === null) continue;
      if (typeof close !== "number" || !Number.isFinite(close) || close < 0)
        throw new Error("Yahoo historical close is invalid");
      const major = toMajorUnit(close, meta.currency);
      if (major.currency !== target.currency) throw new Error("Yahoo historical currency mismatch");
      if (!chosen || observedAt > chosen.evidence.observedAt) {
        chosen = { price: major.price, evidence: { ...target, observedAt, source, retrievedAt, parsedResponseSha256 } };
      }
    }
    if (!chosen) throw new Error("no completed minute within the precommitted observation window");
    return chosen;
  }

  async function readBalances(): Promise<AdapterBalance[]> {
    throw unsupportedCapability(YAHOO_VENUE, "canReadBalances");
  }

  return {
    venue: YAHOO_VENUE,
    // Not a venue anyone holds an account at. "exchange" is the closest word
    // the vocabulary has for a quote source, and it is what coingecko uses.
    kind: "exchange",
    capabilities: { canReadBalances: false, canReadQuotes: true, canPlaceOrders: false },
    readBalances,
    readQuote,
    readHistoricalQuote,
  };
}
