#!/usr/bin/env node
// sync-worker: pulls every account through its venue adapter, converts the book
// into one currency, records a snapshot, and settles the calls whose horizon
// has passed.
//
// It is the piece that makes the other two pillars real: a net worth is only
// current because something fetched it, and a track record is only scored
// because something observed the criterion. Both happen here.
//
// Run: npx tsx sync-worker.mts [--once]

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { type AdapterBalance, type AssetClass, type VenueAdapter, assertCapability } from "@openportfolio/domain";
import {
  connectConvexWatcher,
  createAdapterRegistry,
  createCoingeckoAdapter,
  createConvexClient,
  createCsvAdapter,
  fetchCotFlows,
  createManualAdapter,
  createYahooAdapter,
  fetchFxRates,
  loadEnvLocal,
  rateFor,
  pricesOwnBalances,
  quoteSymbolFor,
  quoteVenueFor,
  readManualHoldingsFile,
  resolveConvexUrl,
  resolveServiceKey,
} from "@openportfolio/node";

const execFileP = promisify(execFile);
const PROJECT_ROOT = resolve(new URL(".", import.meta.url).pathname);

const CONVEX_TIMEOUT_MS = 30_000;
const CLI_MAX_BUFFER = 50 * 1024 * 1024;
const SWEEP_MS = 15 * 60_000;
const CONVEX_BIN = resolve(PROJECT_ROOT, "node_modules/.bin/convex");

// A value already in the real environment wins: the documented way to launch
// this is with the key exported, and a stale .env.local should not beat it.
for (const [key, val] of Object.entries(loadEnvLocal(PROJECT_ROOT))) {
  if (!process.env[key]) process.env[key] = val;
}

const SERVICE_KEY = resolveServiceKey();
const CONVEX_URL = resolveConvexUrl(PROJECT_ROOT);
const TENANT_SLUG = process.env.OPENPORTFOLIO_TENANT;
// An operator's single-venue override. Unset is the normal case: the asset
// class on each row picks the venue instead, so a book of shares and coins is
// priced correctly without anyone configuring anything.
const PINNED_QUOTE_VENUE = process.env.OPENPORTFOLIO_QUOTE_VENUE;
// A forecast criterion names a symbol and nothing else, so this path cannot
// route on asset class the way repricing does. It stays pinned, and guessing is
// what it refuses to do: see quoteVenueFor for what a wrong guess costs.
const FORECAST_QUOTE_VENUE = PINNED_QUOTE_VENUE ?? "coingecko";
const MANUAL_HOLDINGS = process.env.OPENPORTFOLIO_MANUAL_HOLDINGS;
// A directory of broker exports, one <accountKey>.csv per account.
const CSV_DIR = process.env.OPENPORTFOLIO_CSV_DIR;
// Positioning by participant class. On unless switched off: it is free and
// keyless, and a checkout that syncs once should see the flows view populated
// rather than have to be told the pillar works.
const COT_ENABLED = process.env.OPENPORTFOLIO_COT !== "0";

async function convexCli(fn: string, args: unknown): Promise<unknown> {
  const { stdout } = await execFileP(CONVEX_BIN, ["run", fn, JSON.stringify(args)], {
    cwd: PROJECT_ROOT,
    timeout: CONVEX_TIMEOUT_MS,
    maxBuffer: CLI_MAX_BUFFER,
  });
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

const transport = createConvexClient({
  url: CONVEX_URL,
  serviceKey: SERVICE_KEY,
  timeoutMs: CONVEX_TIMEOUT_MS,
  cliFallback: convexCli,
});

// The single boundary cast in this file. The transport speaks JSON and cannot
// know the shape of a function it was handed as a string; everything past this
// line is typed.
async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const withTenant = TENANT_SLUG ? { tenantSlug: TENANT_SLUG, ...args } : args;
  return (await transport(fn, withTenant)) as T;
}

type Account = {
  accountKey: string;
  venue: string;
  label: string;
  currency: string;
};

type StoredBalance = {
  accountKey: string;
  symbol: string;
  assetClass: AssetClass;
  qty: number;
  lastPrice?: number;
  valueLocal: number;
  currency: string;
  costBasis?: number;
  pnl?: number;
};

type SyncRow = StoredBalance & { valueBase: number; fxRate?: number };

function buildRegistry() {
  const adapters: VenueAdapter[] = [createCoingeckoAdapter(), createYahooAdapter()];
  if (MANUAL_HOLDINGS && existsSync(MANUAL_HOLDINGS)) {
    adapters.push(createManualAdapter({ rows: readManualHoldingsFile(MANUAL_HOLDINGS) }));
  }
  // Registered on the directory existing, not on it having files in it: an
  // empty statements directory is an account whose export is late, and the
  // adapter names the file it wanted rather than reporting no holdings.
  if (CSV_DIR && existsSync(CSV_DIR)) {
    adapters.push(createCsvAdapter({ dir: CSV_DIR }));
  }
  return createAdapterRegistry(adapters);
}

const registry = buildRegistry();

// The dashboard's capability flags come from the adapters that exist, not from
// a hand-kept copy of what someone meant to implement.
async function registerVenues(): Promise<void> {
  for (const capability of registry.capabilities()) {
    await call("venues:register", { ...capability, label: capability.venue });
  }
}

// Re-quote a row whose own account cannot price it, through the venue that can
// price that asset class.
//
// This used to reprice crypto and nothing else, which meant every share, ETF
// and fund kept whatever price was typed into the manual holdings file: the
// equity side of a net worth stopped moving the day it was entered, and only
// the coins were live. The class-routed lookup is what makes the single number
// current for a book that is not all crypto.
async function repriced(row: StoredBalance, holder: VenueAdapter): Promise<StoredBalance> {
  if (pricesOwnBalances(holder)) return row;
  const venue = quoteVenueFor(registry, row.assetClass, PINNED_QUOTE_VENUE);
  if (!venue) return row;
  try {
    const symbol = quoteSymbolFor(venue, row.symbol, row.assetClass);
    const quote = await registry.get(venue).readQuote({ symbol, currency: row.currency });
    // The currency comes off the quote, not off the stored row. A quote source
    // reports the listing currency and cannot convert, so a new price under the
    // old currency label is how an LSE share priced in pence gets converted at
    // the pound rate. They move together or the total is wrong.
    return { ...row, lastPrice: quote.price, currency: quote.currency, valueLocal: row.qty * quote.price };
  } catch {
    // A venue outage leaves the last known price in place rather than blanking
    // a position out of the total.
    return row;
  }
}

function toStored(account: Account, balance: AdapterBalance): StoredBalance {
  return {
    accountKey: account.accountKey,
    symbol: balance.symbol,
    assetClass: balance.assetClass,
    qty: balance.qty,
    lastPrice: balance.lastPrice,
    valueLocal: balance.valueLocal,
    currency: balance.currency,
    costBasis: balance.costBasis,
    pnl: balance.pnl,
  };
}

async function collectRows(account: Account): Promise<StoredBalance[]> {
  const adapter = registry.get(account.venue);
  if (adapter.capabilities.canReadBalances) {
    assertCapability(adapter, "canReadBalances");
    const fetched = await adapter.readBalances({ accountKey: account.accountKey });
    const out: StoredBalance[] = [];
    for (const balance of fetched) out.push(toStored(account, balance));
    return out;
  }
  // The venue cannot enumerate holdings, so the backend's rows are the record
  // and this pass only refreshes their prices.
  return await call<StoredBalance[]>("balances:list", { accountKey: account.accountKey });
}

async function syncAccount(account: Account, baseCurrency: string): Promise<number> {
  const adapter = registry.get(account.venue);
  const collected = await collectRows(account);

  const priced: StoredBalance[] = [];
  for (const row of collected) priced.push(await repriced(row, adapter));

  const currencies: string[] = [];
  for (const row of priced) {
    if (!currencies.includes(row.currency)) currencies.push(row.currency);
  }
  const rates = await fetchFxRates(baseCurrency, currencies);

  const rows: SyncRow[] = [];
  for (const row of priced) {
    const rate = rateFor(rates, row.currency);
    if (rate === null) {
      // Counting an unconverted amount would put 100,000 KRW in the total as if
      // it were 100,000 GBP, so the row is skipped and named instead.
      console.warn(`  ! no ${row.currency} -> ${baseCurrency} rate; skipping ${row.symbol}`);
      continue;
    }
    rows.push({ ...row, fxRate: rate, valueBase: row.valueLocal * rate });
  }

  await call("balances:syncAccount", { accountKey: account.accountKey, rows: rows.map(withoutAccountKey) });
  return rows.length;
}

// accountKey rides on the mutation itself, not on each row.
function withoutAccountKey(row: SyncRow) {
  const { accountKey: _ignored, ...rest } = row;
  return rest;
}

// Settling from a live quote rather than waiting for the backend cron to find a
// balance row: a call can name a symbol nobody in the book holds.
type DueForecast = { id: string; subject: string; symbol: string | null };

async function settleDue(): Promise<number> {
  const due = await call<DueForecast[]>("forecasts:listDue", {});
  let settled = 0;
  for (const forecast of due) {
    if (!forecast.symbol) continue;
    if (!registry.has(FORECAST_QUOTE_VENUE)) continue;
    try {
      const quote = await registry.get(FORECAST_QUOTE_VENUE).readQuote({ symbol: forecast.symbol });
      await call("forecasts:settle", {
        forecastId: forecast.id,
        observedValue: quote.price,
        note: `${FORECAST_QUOTE_VENUE} @ ${new Date(quote.asOf).toISOString()}`,
      });
      settled += 1;
    } catch (e) {
      console.warn(`  ! ${forecast.symbol}: ${(e as Error).message}`);
    }
  }
  return settled;
}

// COT is published weekly, and the sweep runs every fifteen minutes. Writing
// the same eight weeks on every pass would be several hundred pointless
// mutations a day, so the newest report date already written is remembered and
// an unchanged one is skipped. Restarting the process rewrites once, which the
// upsert in flows:record absorbs.
let lastCotReport: string | null = null;

async function syncFlows(): Promise<number> {
  if (!COT_ENABLED) return 0;
  const rows = await fetchCotFlows();
  if (rows.length === 0) return 0;
  let newest = rows[0].date;
  for (const row of rows) {
    if (row.date > newest) newest = row.date;
  }
  if (newest === lastCotReport) return 0;
  let written = 0;
  for (const row of rows) {
    await call("flows:record", row);
    written += 1;
  }
  lastCotReport = newest;
  return written;
}

type Whoami = { tenantSlug: string | null; baseCurrency: string | null };

async function syncOnce(): Promise<void> {
  const who = await call<Whoami>("tenants:whoami", {});
  const baseCurrency = who.baseCurrency ?? "USD";
  console.log(`[${new Date().toISOString()}] sync ${who.tenantSlug ?? "(unknown tenant)"} in ${baseCurrency}`);

  await registerVenues();

  const accounts = await call<Account[]>("accounts:list", {});
  for (const account of accounts) {
    if (!registry.has(account.venue)) {
      console.warn(`  ! no adapter for "${account.venue}" (${account.accountKey})`);
      continue;
    }
    try {
      const written = await syncAccount(account, baseCurrency);
      console.log(`  ${account.accountKey}: ${written} positions`);
    } catch (e) {
      console.error(`  x ${account.accountKey}: ${(e as Error).message}`);
    }
  }

  const snapshot = await call<{ totalBase: number }>("netWorth:snapshot", {});
  console.log(`  net worth ${snapshot.totalBase.toFixed(2)} ${baseCurrency}`);

  const settled = await settleDue();
  if (settled > 0) console.log(`  settled ${settled} forecasts`);

  // Last, and caught on its own: an outage at the CFTC must not cost the book
  // its balances, its snapshot or its settlements, all of which already ran.
  try {
    const flows = await syncFlows();
    if (flows > 0) console.log(`  recorded ${flows} flow rows`);
  } catch (e) {
    console.warn(`  ! flows: ${(e as Error).message}`);
  }
}

// One drain at a time. A push arriving mid-sync must not start a second pass
// over the same accounts.
let draining = false;
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    await syncOnce();
  } catch (e) {
    console.error("sync error:", (e as Error).message);
  } finally {
    draining = false;
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--once")) {
    await drain();
    return;
  }

  // The due queue tells us when a call needs settling instead of being asked
  // every few seconds. Balances still sweep on a timer: no push exists for "the
  // market moved".
  const watcher = await connectConvexWatcher({
    url: CONVEX_URL,
    serviceKey: SERVICE_KEY,
    onError: (fn, e) => console.error(`[watch] ${fn}: ${e.message}`),
  });
  if (watcher.live) {
    const args = TENANT_SLUG ? { tenantSlug: TENANT_SLUG } : {};
    watcher.watch("forecasts:listDue", args, () => void drain());
  }
  setInterval(() => void drain(), SWEEP_MS);
  console.log(`sync-worker started, ${SWEEP_MS / 60_000}m sweep, watcher ${watcher.live ? "live" : "off"}`);
  await drain();
}

void main();
