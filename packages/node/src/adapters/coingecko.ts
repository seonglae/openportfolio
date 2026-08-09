// Reference adapter: CoinGecko's public simple/price endpoint.
//
// Chosen because it needs no key, no account and no signature, so a fresh
// checkout can produce a real number on the first run and the adapter contract
// is demonstrated end to end rather than described. It reads quotes only: it
// has no idea what you hold, and says so through its capabilities rather than
// returning an empty balance list that would read as "you hold nothing".

import {
  type AdapterBalance,
  type AdapterQuote,
  type ReadQuoteRequest,
  type VenueAdapter,
  unsupportedCapability,
} from "@openportfolio/domain";

export const COINGECKO_VENUE = "coingecko";
const DEFAULT_BASE_URL = "https://api.coingecko.com/api/v3";
const DEFAULT_CURRENCY = "usd";
const DEFAULT_TIMEOUT_MS = 10_000;
const MS_PER_SEC = 1000;

// Quote-currency suffixes exchanges glue onto a ticker. Longest first, so
// "BTCUSDT" loses "USDT" rather than "USD" and a "T" that is not a currency.
const QUOTE_SUFFIXES = ["USDT", "USDC", "KRW", "USD", "EUR", "GBP", "JPY"];

// CoinGecko addresses coins by id, not ticker, and the two disagree exactly
// where it hurts: "ETH" is `ethereum`, but the id `eth` belongs to something
// else entirely. Only the majors are aliased here; anything else is assumed to
// be an id already, which is what the /coins/list endpoint hands you.
const SYMBOL_TO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  DOT: "polkadot",
  MATIC: "matic-network",
  TRX: "tron",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  ATOM: "cosmos",
  USDT: "tether",
  USDC: "usd-coin",
};

export function stripQuoteSuffix(symbol: string): string {
  const upper = symbol.toUpperCase();
  for (const suffix of QUOTE_SUFFIXES) {
    if (upper.length > suffix.length && upper.endsWith(suffix)) return upper.slice(0, -suffix.length);
  }
  return upper;
}

export function coingeckoId(symbol: string): string {
  const base = stripQuoteSuffix(symbol);
  const aliased = SYMBOL_TO_ID[base];
  if (aliased) return aliased;
  return symbol.toLowerCase();
}

export type CoingeckoOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type SimplePriceRow = Record<string, number | undefined>;
type SimplePriceResponse = Record<string, SimplePriceRow | undefined>;

export function createCoingeckoAdapter(opts: CoingeckoOptions = {}): VenueAdapter {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function readQuote(request: ReadQuoteRequest): Promise<AdapterQuote> {
    const id = coingeckoId(request.symbol);
    const currency = (request.currency ?? DEFAULT_CURRENCY).toLowerCase();
    const url = `${baseUrl}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${encodeURIComponent(currency)}&include_last_updated_at=true`;
    const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`coingecko ${res.status} for ${id}`);
    const body = (await res.json()) as SimplePriceResponse;
    const row = body[id];
    if (!row) throw new Error(`coingecko has no coin "${id}" (from symbol "${request.symbol}")`);
    const price = row[currency];
    if (typeof price !== "number") throw new Error(`coingecko has no ${currency} price for "${id}"`);
    // The endpoint reports when it last saw the price. Falling back to our own
    // clock would let a stale quote claim to be fresh.
    const lastUpdated = row.last_updated_at;
    let asOf = Date.now();
    if (typeof lastUpdated === "number") asOf = lastUpdated * MS_PER_SEC;
    return { symbol: request.symbol.toUpperCase(), price, currency: currency.toUpperCase(), asOf };
  }

  async function readBalances(): Promise<AdapterBalance[]> {
    throw unsupportedCapability(COINGECKO_VENUE, "canReadBalances");
  }

  return {
    venue: COINGECKO_VENUE,
    kind: "exchange",
    capabilities: { canReadBalances: false, canReadQuotes: true, canPlaceOrders: false },
    readBalances,
    readQuote,
  };
}
