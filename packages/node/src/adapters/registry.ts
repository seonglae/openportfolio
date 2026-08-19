// Venue lookup for the sync worker.
//
// The registry is per-process and built from what the operator configured, so
// an unregistered venue fails at dispatch with the registered names listed
// rather than at the first property access on undefined.

import { type AssetClass, type VenueAdapter, type VenueCapabilities, assertCapability } from "@openportfolio/domain";
import { COINGECKO_VENUE, createCoingeckoAdapter } from "./coingecko.ts";
import { YAHOO_VENUE, createYahooAdapter } from "./yahoo.ts";

export type AdapterRegistry = {
  register(adapter: VenueAdapter): void;
  get(venue: string): VenueAdapter;
  has(venue: string): boolean;
  venues(): string[];
  // What the backend's `venues` table should say about each adapter, so the
  // dashboard's capability flags come from the code rather than a hand-kept
  // copy of it.
  capabilities(): Array<{ venue: string; kind: string } & VenueCapabilities>;
};

export function createAdapterRegistry(initial: readonly VenueAdapter[] = []): AdapterRegistry {
  const byVenue = new Map<string, VenueAdapter>();
  for (const adapter of initial) byVenue.set(adapter.venue, adapter);

  return {
    register(adapter) {
      byVenue.set(adapter.venue, adapter);
    },
    get(venue) {
      const adapter = byVenue.get(venue);
      if (!adapter) throw new Error(`no adapter for venue "${venue}" (registered: ${[...byVenue.keys()].join(", ")})`);
      return adapter;
    },
    has(venue) {
      return byVenue.has(venue);
    },
    venues() {
      return [...byVenue.keys()];
    },
    capabilities() {
      const out: Array<{ venue: string; kind: string } & VenueCapabilities> = [];
      for (const adapter of byVenue.values()) {
        out.push({ venue: adapter.venue, kind: adapter.kind, ...adapter.capabilities });
      }
      return out;
    },
  };
}

// The registry a fresh checkout gets. Only the keyless quote sources: every
// other venue is something the operator has to configure, and shipping a
// half-configured broker adapter would make the empty case look like an outage.
export function defaultRegistry(): AdapterRegistry {
  return createAdapterRegistry([createCoingeckoAdapter(), createYahooAdapter()]);
}

// Which venue prices which asset class.
//
// Nothing here falls back to another venue, and that is the point. Both quote
// sources answer the wrong instrument with an HTTP 200 rather than an error:
// Yahoo prices "BTC" as the Grayscale Bitcoin Mini Trust near $30 instead of
// bitcoin near $68,000, and CoinGecko has a token with the id "aapl" worth
// about 18 cents. Either substitution produces a wrong net worth, which is
// strictly worse than a missing one, so the asset class on the balance row
// decides and an unlisted class is simply not repriced.
//
// `cash` is absent on purpose: a currency balance is converted by the FX rates,
// not quoted, and `other` is absent because the name says we do not know.
const QUOTE_VENUE_BY_CLASS: Partial<Record<AssetClass, string>> = {
  equity: YAHOO_VENUE,
  etf: YAHOO_VENUE,
  fund: YAHOO_VENUE,
  bond: YAHOO_VENUE,
  derivative: YAHOO_VENUE,
  crypto: COINGECKO_VENUE,
};

// Yahoo lists coins under a quote-currency pair, so a book that stores "BTC"
// has to ask for "BTC-USD". Only reached when an operator has pinned Yahoo for
// everything; the default route sends crypto to CoinGecko, which wants the bare
// ticker.
export function quoteSymbolFor(venue: string, symbol: string, assetClass: AssetClass): string {
  if (venue !== YAHOO_VENUE || assetClass !== "crypto") return symbol;
  if (symbol.includes("-")) return symbol.toUpperCase();
  return `${symbol.toUpperCase()}-USD`;
}

// `pinned` is the operator's single-venue override. Returns null when nothing
// registered can price the class, which callers read as "leave the stored price
// alone" rather than as an error.
export function quoteVenueFor(
  registry: AdapterRegistry,
  assetClass: AssetClass,
  pinned?: string,
): string | null {
  const venue = pinned ?? QUOTE_VENUE_BY_CLASS[assetClass];
  if (!venue) return null;
  if (!registry.has(venue)) return null;
  if (!registry.get(venue).capabilities.canReadQuotes) return null;
  return venue;
}

export async function quoteThrough(registry: AdapterRegistry, venue: string, symbol: string, currency?: string) {
  const adapter = registry.get(venue);
  assertCapability(adapter, "canReadQuotes");
  return await adapter.readQuote({ symbol, currency });
}

export async function balancesThrough(registry: AdapterRegistry, venue: string, accountKey: string) {
  const adapter = registry.get(venue);
  assertCapability(adapter, "canReadBalances");
  return await adapter.readBalances({ accountKey });
}
