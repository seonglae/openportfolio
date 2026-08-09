import { v } from "convex/values";
import type { AssetClass } from "@openportfolio/domain";
import { mutation, query } from "./_generated/server";
import { type TenantScope, requireRole, requireTenant } from "./auth";
import { appendAudit } from "./audit";
import type { Ctx } from "./auth";

const DEFAULT_HISTORY_LIMIT = 90;
const MAX_HISTORY_LIMIT = 1000;
const FALLBACK_BASE_CURRENCY = "USD";

type Aggregate = {
  baseCurrency: string;
  totalBase: number;
  byVenue: Array<{ venue: string; valueBase: number }>;
  byAssetClass: Array<{ assetClass: AssetClass; valueBase: number }>;
  accountCount: number;
};

// Computed from the balance rows as they stand, never from a previous snapshot.
// Each row was converted to the base currency when it was written, with the
// rate it was written at, so a snapshot is a record of what the book was worth
// then rather than what today's rates say it was worth.
async function aggregate(ctx: Ctx, scope: TenantScope): Promise<Aggregate> {
  const tenant = await ctx.db.get(scope.tenantId);
  const accounts = await ctx.db
    .query("accounts")
    .withIndex("by_tenant", (q) => q.eq("tenantId", scope.tenantId))
    .collect();
  const venueOf = new Map(accounts.map((account) => [account.accountKey, account.venue]));

  const balances = await ctx.db
    .query("balances")
    .withIndex("by_tenant", (q) => q.eq("tenantId", scope.tenantId))
    .collect();

  const perVenue = new Map<string, number>();
  const perAssetClass = new Map<AssetClass, number>();
  const seenAccounts = new Set<string>();
  let totalBase = 0;

  for (const row of balances) {
    // An account that was unlinked keeps its rows, so its value is attributed
    // to a venue named for the gap rather than dropped into the total unlabelled.
    const venue = venueOf.get(row.accountKey) ?? "unlinked";
    perVenue.set(venue, (perVenue.get(venue) ?? 0) + row.valueBase);
    perAssetClass.set(row.assetClass, (perAssetClass.get(row.assetClass) ?? 0) + row.valueBase);
    seenAccounts.add(row.accountKey);
    totalBase += row.valueBase;
  }

  const byVenue: Array<{ venue: string; valueBase: number }> = [];
  for (const [venue, valueBase] of perVenue) byVenue.push({ venue, valueBase });
  byVenue.sort((a, b) => b.valueBase - a.valueBase);

  const byAssetClass: Array<{ assetClass: AssetClass; valueBase: number }> = [];
  for (const [assetClass, valueBase] of perAssetClass) byAssetClass.push({ assetClass, valueBase });
  byAssetClass.sort((a, b) => b.valueBase - a.valueBase);

  return {
    baseCurrency: tenant?.baseCurrency ?? FALLBACK_BASE_CURRENCY,
    totalBase,
    byVenue,
    byAssetClass,
    accountCount: seenAccounts.size,
  };
}

// The live number, computed on read. Nothing is written, so the dashboard can
// call it as often as it likes.
export const current = query({
  args: { serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    return await aggregate(ctx, scope);
  },
});

// The recorded number, written on a cron or on demand. Snapshots are what the
// history chart reads; they are never recomputed after the fact.
export const snapshot = mutation({
  args: { at: v.optional(v.number()), serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const totals = await aggregate(ctx, scope);
    const at = args.at ?? Date.now();
    const id = await ctx.db.insert("netWorthSnapshots", { tenantId: scope.tenantId, at, ...totals });
    await appendAudit(ctx, scope, {
      kind: "netWorth.snapshot",
      subject: `${totals.totalBase.toFixed(2)} ${totals.baseCurrency}`,
      detail: `${totals.accountCount} accounts`,
    });
    return { id, at, totalBase: totals.totalBase, baseCurrency: totals.baseCurrency };
  },
});

export const history = query({
  args: {
    limit: v.optional(v.number()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    const limit = Math.min(args.limit ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
    const rows = await ctx.db
      .query("netWorthSnapshots")
      .withIndex("by_tenant_at", (q) => q.eq("tenantId", scope.tenantId))
      .order("desc")
      .take(limit);
    // Oldest first: a chart reads left to right.
    return rows.reverse();
  },
});
