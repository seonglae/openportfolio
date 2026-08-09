import { v } from "convex/values";
import { ASSET_CLASSES } from "@openportfolio/domain";
import { mutation, query } from "./_generated/server";
import { requireRole, requireTenant } from "./auth";
import { appendAudit } from "./audit";
import { literals } from "./validators";

const BALANCE_ROW = v.object({
  symbol: v.string(),
  assetClass: literals(ASSET_CLASSES),
  qty: v.number(),
  lastPrice: v.optional(v.number()),
  valueLocal: v.number(),
  valueBase: v.number(),
  fxRate: v.optional(v.number()),
  currency: v.string(),
  costBasis: v.optional(v.number()),
  pnl: v.optional(v.number()),
});

// A sync replaces the account's whole position list, it does not merge into it.
// Merging leaves a sold-out position on the books forever, which overstates net
// worth silently and in the one direction nobody checks.
export const syncAccount = mutation({
  args: {
    accountKey: v.string(),
    asOf: v.optional(v.number()),
    rows: v.array(BALANCE_ROW),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", scope.tenantId).eq("accountKey", args.accountKey))
      .first();
    if (!account) throw new Error(`no account "${args.accountKey}"`);

    const asOf = args.asOf ?? Date.now();
    const existing = await ctx.db
      .query("balances")
      .withIndex("by_tenant_account", (q) => q.eq("tenantId", scope.tenantId).eq("accountKey", args.accountKey))
      .collect();
    const bySymbol = new Map(existing.map((row) => [row.symbol, row]));

    let written = 0;
    for (const row of args.rows) {
      const prior = bySymbol.get(row.symbol);
      if (prior) {
        await ctx.db.patch(prior._id, { ...row, asOf });
        bySymbol.delete(row.symbol);
      } else {
        await ctx.db.insert("balances", {
          tenantId: scope.tenantId,
          accountKey: args.accountKey,
          asOf,
          ...row,
        });
      }
      written += 1;
    }

    let removed = 0;
    for (const stale of bySymbol.values()) {
      await ctx.db.delete(stale._id);
      removed += 1;
    }

    await ctx.db.patch(account._id, { syncedAt: asOf, updatedAt: Date.now() });
    await appendAudit(ctx, scope, {
      kind: "balances.synced",
      subject: args.accountKey,
      detail: `${written} held, ${removed} closed`,
    });
    return { written, removed, asOf };
  },
});

export const list = query({
  args: {
    accountKey: v.optional(v.string()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    if (args.accountKey) {
      const accountKey = args.accountKey;
      return await ctx.db
        .query("balances")
        .withIndex("by_tenant_account", (q) => q.eq("tenantId", scope.tenantId).eq("accountKey", accountKey))
        .collect();
    }
    return await ctx.db
      .query("balances")
      .withIndex("by_tenant", (q) => q.eq("tenantId", scope.tenantId))
      .collect();
  },
});

// One symbol across every account. The same name held in an ISA, a pension and
// an exchange is one exposure, and seeing it split three ways is how a position
// gets to twice the size anyone intended.
export const bySymbol = query({
  args: { symbol: v.string(), serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    const rows = await ctx.db
      .query("balances")
      .withIndex("by_tenant_symbol", (q) => q.eq("tenantId", scope.tenantId).eq("symbol", args.symbol))
      .collect();
    let qty = 0;
    let valueBase = 0;
    for (const row of rows) {
      qty += row.qty;
      valueBase += row.valueBase;
    }
    return { symbol: args.symbol, qty, valueBase, rows };
  },
});
