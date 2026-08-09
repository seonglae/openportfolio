// Venue lookup for the sync worker.
//
// The registry is per-process and built from what the operator configured, so
// an unregistered venue fails at dispatch with the registered names listed
// rather than at the first property access on undefined.

import { type VenueAdapter, type VenueCapabilities, assertCapability } from "@openportfolio/domain";
import { createCoingeckoAdapter } from "./coingecko.ts";

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

// The registry a fresh checkout gets. Only the keyless quote source: every
// other venue is something the operator has to configure, and shipping a
// half-configured broker adapter would make the empty case look like an outage.
export function defaultRegistry(): AdapterRegistry {
  return createAdapterRegistry([createCoingeckoAdapter()]);
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
