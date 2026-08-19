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

import {
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
};
type ChartResponse = {
  chart?: {
    result?: Array<{ meta?: ChartMeta }> | null;
    error?: { code?: string; description?: string } | null;
  };
};

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
    const body = (await res.json().catch(() => null)) as ChartResponse | null;
    const failure = body?.chart?.error;
    if (failure) throw new Error(`yahoo: ${failure.description ?? failure.code ?? "error"} for "${symbol}"`);
    if (!res.ok) throw new Error(`yahoo ${res.status} for "${symbol}"`);
    const meta = body?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error(`yahoo returned no result for "${symbol}"`);
    const price = meta.regularMarketPrice;
    if (typeof price !== "number") throw new Error(`yahoo has no price for "${symbol}"`);

    // The listing currency, which is the one the price is actually in. A request
    // that asked for another one gets told what it got instead of having a
    // number relabelled: converting is the caller's job, and it is the caller
    // that knows which rate it wants and when it was taken.
    const major = toMajorUnit(price, meta.currency ?? request.currency ?? "USD");

    // The exchange's own timestamp. Our clock here would let Friday's close
    // claim to be a Sunday price.
    let asOf = Date.now();
    if (typeof meta.regularMarketTime === "number") asOf = meta.regularMarketTime * MS_PER_SEC;

    return { symbol: meta.symbol ?? symbol, price: major.price, currency: major.currency, asOf };
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
  };
}
