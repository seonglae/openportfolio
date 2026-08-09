// Manual adapter: holdings the operator maintains by hand.
//
// The unglamorous half of "one net worth". A pension, an unlisted holding, a
// property, a bank account behind a login no API reaches: leaving them out does
// not make the number cautious, it makes it wrong, and wrong in the direction
// that changes decisions. Rows come either from a JSON file on disk or from the
// tenant's own table, so the same adapter serves the CLI and the backend.

import {
  type AdapterBalance,
  type AdapterQuote,
  type AssetClass,
  type ReadBalancesRequest,
  type ReadQuoteRequest,
  type VenueAdapter,
} from "@openportfolio/domain";
import { readFileSync } from "node:fs";

export const MANUAL_VENUE = "manual";

export type ManualHolding = {
  accountKey: string;
  symbol: string;
  assetClass: AssetClass;
  qty: number;
  // The price the operator recorded. There is no market to ask, which is the
  // whole reason the row is manual.
  price: number;
  currency: string;
  costBasis?: number;
  // When the operator last touched this row. Stale by construction, and shown
  // as such rather than passed off as a live quote.
  asOf?: number;
};

export type ManualOptions = {
  rows: readonly ManualHolding[];
  // Used when a row carries no asOf of its own.
  defaultAsOf?: number;
};

export function createManualAdapter(opts: ManualOptions): VenueAdapter {
  const fallbackAsOf = opts.defaultAsOf ?? Date.now();

  async function readBalances(request: ReadBalancesRequest): Promise<AdapterBalance[]> {
    const out: AdapterBalance[] = [];
    for (const row of opts.rows) {
      if (row.accountKey !== request.accountKey) continue;
      const valueLocal = row.qty * row.price;
      const balance: AdapterBalance = {
        symbol: row.symbol,
        assetClass: row.assetClass,
        qty: row.qty,
        lastPrice: row.price,
        valueLocal,
        currency: row.currency,
      };
      if (typeof row.costBasis === "number") {
        balance.costBasis = row.costBasis;
        balance.pnl = valueLocal - row.costBasis;
      }
      out.push(balance);
    }
    return out;
  }

  async function readQuote(request: ReadQuoteRequest): Promise<AdapterQuote> {
    const wanted = request.symbol.toUpperCase();
    for (const row of opts.rows) {
      if (row.symbol.toUpperCase() !== wanted) continue;
      return { symbol: wanted, price: row.price, currency: row.currency, asOf: row.asOf ?? fallbackAsOf };
    }
    throw new Error(`manual holdings carry no price for "${request.symbol}"`);
  }

  return {
    venue: MANUAL_VENUE,
    kind: "manual",
    capabilities: { canReadBalances: true, canReadQuotes: true, canPlaceOrders: false },
    readBalances,
    readQuote,
  };
}

const REQUIRED_FIELDS = ["accountKey", "symbol", "assetClass", "qty", "price", "currency"] as const;

// Validated rather than trusted: this file is hand-edited, and a typo that
// reaches the aggregate as `undefined * price` produces a NaN net worth that is
// far harder to trace back than a parse error naming the row.
export function parseManualHoldings(text: string): ManualHolding[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("manual holdings file must contain a JSON array");
  const out: ManualHolding[] = [];
  for (const [index, raw] of parsed.entries()) {
    if (typeof raw !== "object" || raw === null) throw new Error(`manual holdings row ${index} is not an object`);
    const row = raw as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
      if (row[field] === undefined) throw new Error(`manual holdings row ${index} is missing "${field}"`);
    }
    const qty = row.qty;
    const price = row.price;
    if (typeof qty !== "number" || !Number.isFinite(qty)) throw new Error(`manual holdings row ${index}: bad qty`);
    if (typeof price !== "number" || !Number.isFinite(price))
      throw new Error(`manual holdings row ${index}: bad price`);
    out.push({
      accountKey: String(row.accountKey),
      symbol: String(row.symbol),
      assetClass: row.assetClass as AssetClass,
      qty,
      price,
      currency: String(row.currency),
      costBasis: typeof row.costBasis === "number" ? row.costBasis : undefined,
      asOf: typeof row.asOf === "number" ? row.asOf : undefined,
    });
  }
  return out;
}

export function readManualHoldingsFile(path: string): ManualHolding[] {
  return parseManualHoldings(readFileSync(path, "utf8"));
}
