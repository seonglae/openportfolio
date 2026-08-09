import { v } from "convex/values";
import { INVESTOR_TYPES, type InvestorType } from "@openportfolio/domain";
import { mutation, query } from "./_generated/server";
import { requireRole, requireTenant } from "./auth";
import { appendAudit } from "./audit";
import { literals } from "./validators";

const DEFAULT_DAYS = 30;
const MAX_ROWS = 2000;

const INVESTOR_TYPE = literals(INVESTOR_TYPES);

// Who bought and who was made to sell, per session. Price is the output of
// this, not the other way round, so it is stored as a first-class series rather
// than derived when someone remembers to ask.
//
// Upsert on (market, symbol, date, investorType): the same session gets
// restated by the exchange, and two rows for one session would double a total
// that people read as a fact.
export const record = mutation({
  args: {
    market: v.string(),
    symbol: v.optional(v.string()),
    date: v.string(),
    investorType: INVESTOR_TYPE,
    netBuyValue: v.number(),
    turnoverValue: v.optional(v.number()),
    currency: v.string(),
    source: v.string(),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const sameDay = await ctx.db
      .query("flows")
      .withIndex("by_tenant_market_date", (q) =>
        q.eq("tenantId", scope.tenantId).eq("market", args.market).eq("date", args.date),
      )
      .collect();
    const existing = sameDay.find((row) => row.investorType === args.investorType && row.symbol === args.symbol);

    const fields = {
      netBuyValue: args.netBuyValue,
      turnoverValue: args.turnoverValue,
      currency: args.currency,
      source: args.source,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("flows", {
      tenantId: scope.tenantId,
      market: args.market,
      symbol: args.symbol,
      date: args.date,
      investorType: args.investorType,
      createdAt: Date.now(),
      ...fields,
    });
    await appendAudit(ctx, scope, {
      kind: "flow.recorded",
      subject: `${args.market} ${args.date}`,
      detail: `${args.investorType} ${args.netBuyValue}`,
    });
    return { id, created: true };
  },
});

export const list = query({
  args: {
    market: v.optional(v.string()),
    symbol: v.optional(v.string()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    let rows;
    if (args.symbol) {
      const symbol = args.symbol;
      rows = await ctx.db
        .query("flows")
        .withIndex("by_tenant_symbol_date", (q) => q.eq("tenantId", scope.tenantId).eq("symbol", symbol))
        .order("desc")
        .take(MAX_ROWS);
    } else if (args.market) {
      const market = args.market;
      rows = await ctx.db
        .query("flows")
        .withIndex("by_tenant_market_date", (q) => q.eq("tenantId", scope.tenantId).eq("market", market))
        .order("desc")
        .take(MAX_ROWS);
    } else {
      rows = await ctx.db
        .query("flows")
        .withIndex("by_tenant_date", (q) => q.eq("tenantId", scope.tenantId))
        .order("desc")
        .take(MAX_ROWS);
    }
    return rows.filter((row) => {
      if (args.fromDate && row.date < args.fromDate) return false;
      if (args.toDate && row.date > args.toDate) return false;
      return true;
    });
  },
});

// Net buying by investor type over a window, which is the shape the question is
// actually asked in: not "what did foreigners do on Tuesday" but "who has been
// absorbing the supply all month".
export const netByInvestor = query({
  args: {
    market: v.string(),
    days: v.optional(v.number()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    const rows = await ctx.db
      .query("flows")
      .withIndex("by_tenant_market_date", (q) => q.eq("tenantId", scope.tenantId).eq("market", args.market))
      .order("desc")
      .take(MAX_ROWS);

    const days = args.days ?? DEFAULT_DAYS;
    const dates: string[] = [];
    for (const row of rows) {
      if (!dates.includes(row.date)) dates.push(row.date);
    }
    const kept = new Set(dates.slice(0, days));

    const totals = new Map<InvestorType, number>();
    let currency = "";
    for (const row of rows) {
      if (!kept.has(row.date)) continue;
      totals.set(row.investorType, (totals.get(row.investorType) ?? 0) + row.netBuyValue);
      currency = row.currency;
    }

    const byInvestor: Array<{ investorType: InvestorType; netBuyValue: number }> = [];
    for (const [investorType, netBuyValue] of totals) byInvestor.push({ investorType, netBuyValue });
    byInvestor.sort((a, b) => b.netBuyValue - a.netBuyValue);
    return { market: args.market, sessions: kept.size, currency, byInvestor };
  },
});
