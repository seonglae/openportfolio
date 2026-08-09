// The venue adapter contract.
//
// A venue is anything that can tell you what you hold or what something is
// worth: a broker, a bank, an exchange, a chain explorer, or a JSON file you
// maintain by hand. Adapters declare what they can do up front through
// `capabilities`, and the runner checks the flag before it calls the method.
// That is why an adapter can honestly implement only part of the surface: a
// public quote endpoint knows prices and knows nothing about your accounts.
//
// See AGENTS.md for how to add a keyed broker adapter without putting a
// credential anywhere in this repo.

import type { AccountKind, AssetClass, OrderSide, OrderType } from "./enums.ts";

export type VenueCapabilities = {
  canReadBalances: boolean;
  canReadQuotes: boolean;
  // False for every adapter shipped here. Execution is opt-in per venue, and
  // even then it is gated behind an explicit human confirmation carried on the
  // request itself.
  canPlaceOrders: boolean;
};

export const NO_CAPABILITIES: VenueCapabilities = {
  canReadBalances: false,
  canReadQuotes: false,
  canPlaceOrders: false,
};

export type AdapterBalance = {
  symbol: string;
  assetClass: AssetClass;
  qty: number;
  lastPrice?: number;
  // In the account's own currency. Converting to the tenant's base currency is
  // the caller's job, because only the caller knows the rate it wants to use
  // and when it was taken.
  valueLocal: number;
  currency: string;
  costBasis?: number;
  pnl?: number;
};

export type AdapterQuote = {
  symbol: string;
  price: number;
  currency: string;
  // When the venue says the price was taken, not when we asked. A stale quote
  // that claims to be fresh is worse than no quote.
  asOf: number;
};

export type ReadBalancesRequest = {
  accountKey: string;
  // Adapter-specific, non-secret parameters (a file path, an address, a
  // sub-account label). Credentials never travel through here.
  params?: Record<string, string>;
};

export type ReadQuoteRequest = {
  symbol: string;
  // Preferred quote currency. An adapter that cannot honour it returns what it
  // has and says so in `currency`.
  currency?: string;
};

// The confirmation is a required field, not a flag with a default. An order
// that no human confirmed cannot be constructed, which is the whole posture of
// this project expressed as a type.
export type OrderConfirmation = {
  confirmedBy: string;
  confirmedAt: number;
  note?: string;
};

export type PlaceOrderRequest = {
  accountKey: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  qty: number;
  limitPrice?: number;
  clientRef: string;
  confirmation: OrderConfirmation;
};

export type OrderReceipt = {
  accepted: boolean;
  venueOrderId?: string;
  note?: string;
};

export type VenueAdapter = {
  venue: string;
  kind: AccountKind;
  capabilities: VenueCapabilities;
  readBalances(request: ReadBalancesRequest): Promise<AdapterBalance[]>;
  readQuote(request: ReadQuoteRequest): Promise<AdapterQuote>;
  placeOrder?(request: PlaceOrderRequest): Promise<OrderReceipt>;
};

export const UNSUPPORTED_CAPABILITY = "unsupported_capability";

export function unsupportedCapability(venue: string, capability: keyof VenueCapabilities): Error {
  return Object.assign(new Error(`${venue} does not support ${capability}`), { code: UNSUPPORTED_CAPABILITY });
}

// Call before dispatching. Checking the declared flag rather than probing for
// the method means a half-implemented adapter fails at the boundary with a
// readable message instead of somewhere inside a fetch.
export function assertCapability(adapter: VenueAdapter, capability: keyof VenueCapabilities): void {
  if (!adapter.capabilities[capability]) throw unsupportedCapability(adapter.venue, capability);
  if (capability === "canPlaceOrders" && !adapter.placeOrder) {
    throw unsupportedCapability(adapter.venue, capability);
  }
}
