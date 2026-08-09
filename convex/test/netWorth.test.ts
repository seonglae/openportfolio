import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import { type Harness, type SeededTenant, seedTenant, withConvex } from "./harness.setup";

type Row = {
  symbol: string;
  assetClass: "equity" | "crypto" | "cash" | "other";
  qty: number;
  valueLocal: number;
  valueBase: number;
  currency: string;
  lastPrice?: number;
};

async function linkAndSync(t: Harness, tenant: SeededTenant, accountKey: string, venue: string, rows: Row[]) {
  await t.mutation(api.accounts.link, {
    serviceKey: tenant.serviceKey,
    accountKey,
    venue,
    kind: "brokerage",
    label: accountKey,
    currency: "GBP",
  });
  await t.mutation(api.balances.syncAccount, { serviceKey: tenant.serviceKey, accountKey, rows });
}

describe("one net worth", () => {
  it("adds up every account in the tenant's base currency", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha", { baseCurrency: "GBP" });
    await linkAndSync(t, alpha, "isa", "manual", [
      { symbol: "VWRL", assetClass: "equity", qty: 10, valueLocal: 1200, valueBase: 1200, currency: "GBP" },
    ]);
    await linkAndSync(t, alpha, "exchange", "coingecko", [
      { symbol: "BTC", assetClass: "crypto", qty: 0.1, valueLocal: 6000, valueBase: 4800, currency: "USD" },
    ]);

    const now = await t.query(api.netWorth.current, { serviceKey: alpha.serviceKey });
    expect(now.totalBase).toBe(6000);
    expect(now.baseCurrency).toBe("GBP");
    expect(now.accountCount).toBe(2);
    // Sorted by size, because that is the order the question is asked in.
    expect(now.byVenue).toEqual([
      { venue: "coingecko", valueBase: 4800 },
      { venue: "manual", valueBase: 1200 },
    ]);
    expect(now.byAssetClass[0]).toEqual({ assetClass: "crypto", valueBase: 4800 });
  });

  // Merging would leave a sold-out position on the books forever, overstating
  // net worth silently and in the direction nobody checks.
  it("drops a position the venue no longer reports", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await linkAndSync(t, alpha, "isa", "manual", [
      { symbol: "A", assetClass: "equity", qty: 1, valueLocal: 100, valueBase: 100, currency: "GBP" },
      { symbol: "B", assetClass: "equity", qty: 1, valueLocal: 50, valueBase: 50, currency: "GBP" },
    ]);
    const second = await t.mutation(api.balances.syncAccount, {
      serviceKey: alpha.serviceKey,
      accountKey: "isa",
      rows: [{ symbol: "A", assetClass: "equity", qty: 1, valueLocal: 120, valueBase: 120, currency: "GBP" }],
    });
    expect(second).toMatchObject({ written: 1, removed: 1 });
    expect((await t.query(api.netWorth.current, { serviceKey: alpha.serviceKey })).totalBase).toBe(120);
  });

  // The rows stay when an account is unlinked, so past snapshots still add up.
  // Their value has to go somewhere the reader can see rather than into the
  // total unlabelled.
  it("attributes an unlinked account's holdings to a named gap", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await linkAndSync(t, alpha, "isa", "manual", [
      { symbol: "A", assetClass: "equity", qty: 1, valueLocal: 100, valueBase: 100, currency: "GBP" },
    ]);
    await t.mutation(api.accounts.unlink, { serviceKey: alpha.serviceKey, accountKey: "isa" });
    const now = await t.query(api.netWorth.current, { serviceKey: alpha.serviceKey });
    expect(now.totalBase).toBe(100);
    expect(now.byVenue[0].venue).toBe("manual");
  });

  it("sums one symbol held in several accounts as one exposure", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await linkAndSync(t, alpha, "isa", "manual", [
      { symbol: "VWRL", assetClass: "equity", qty: 10, valueLocal: 1200, valueBase: 1200, currency: "GBP" },
    ]);
    await linkAndSync(t, alpha, "sipp", "manual", [
      { symbol: "VWRL", assetClass: "equity", qty: 5, valueLocal: 600, valueBase: 600, currency: "GBP" },
    ]);
    const exposure = await t.query(api.balances.bySymbol, { serviceKey: alpha.serviceKey, symbol: "VWRL" });
    expect(exposure).toMatchObject({ qty: 15, valueBase: 1800 });
  });
});

describe("snapshots", () => {
  it("records what the book was worth then, and reads back oldest first", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await linkAndSync(t, alpha, "isa", "manual", [
      { symbol: "A", assetClass: "equity", qty: 1, valueLocal: 100, valueBase: 100, currency: "GBP" },
    ]);
    await t.mutation(api.netWorth.snapshot, { serviceKey: alpha.serviceKey, at: 1000 });
    await t.mutation(api.balances.syncAccount, {
      serviceKey: alpha.serviceKey,
      accountKey: "isa",
      rows: [{ symbol: "A", assetClass: "equity", qty: 1, valueLocal: 150, valueBase: 150, currency: "GBP" }],
    });
    await t.mutation(api.netWorth.snapshot, { serviceKey: alpha.serviceKey, at: 2000 });

    const history = await t.query(api.netWorth.history, { serviceKey: alpha.serviceKey });
    expect(history.map((row) => row.totalBase)).toEqual([100, 150]);
  });

  it("keeps one tenant's history out of another's", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const beta = await seedTenant(t, "beta");
    await linkAndSync(t, alpha, "isa", "manual", [
      { symbol: "A", assetClass: "equity", qty: 1, valueLocal: 100, valueBase: 100, currency: "GBP" },
    ]);
    await t.mutation(api.netWorth.snapshot, { serviceKey: alpha.serviceKey });
    expect(await t.query(api.netWorth.history, { serviceKey: beta.serviceKey })).toEqual([]);
    expect((await t.query(api.netWorth.current, { serviceKey: beta.serviceKey })).totalBase).toBe(0);
  });
});
