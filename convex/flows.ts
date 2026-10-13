import { v } from "convex/values";
import { INVESTOR_TYPES, normalizeFlow, type InvestorType } from "@openportfolio/domain";
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
    openInterestContracts: v.optional(v.number()),
    measurement: v.optional(v.union(v.literal("net_buying"), v.literal("net_position_change"))),
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
    const existing = sameDay.find(
      (row) =>
        normalizeFlow(row).investorType === normalizeFlow(args).investorType &&
        row.symbol === args.symbol &&
        row.source === args.source,
    );

    if (
      !Number.isFinite(args.netBuyValue) ||
      (args.turnoverValue !== undefined && (!Number.isFinite(args.turnoverValue) || args.turnoverValue < 0)) ||
      (args.openInterestContracts !== undefined &&
        (!Number.isFinite(args.openInterestContracts) || args.openInterestContracts < 0))
    ) {
      throw new Error("flow values must be finite; turnover and open interest must be nonnegative");
    }
    const normalized = normalizeFlow(args);
    const fields = {
      netBuyValue: args.netBuyValue,
      investorType: normalized.investorType,
      turnoverValue: normalized.turnoverValue,
      openInterestContracts: normalized.openInterestContracts,
      measurement: normalized.measurement,
      currency: args.currency,
      source: args.source,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      await appendAudit(ctx, scope, {
        kind: "flow.recorded",
        subject: `${args.market} ${args.date}`,
        detail: `restated ${normalized.investorType} ${args.netBuyValue} ${args.currency} ${args.source}`,
      });
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("flows", {
      tenantId: scope.tenantId,
      market: args.market,
      symbol: args.symbol,
      date: args.date,
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
    return rows.map(normalizeFlow).filter((row) => {
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
    if (!Number.isInteger(days) || days < 1)
      throw new Error("days must be a positive integer number of reporting periods");
    const normalizedRows = rows.map(normalizeFlow);
    const dates: string[] = [];
    for (const row of normalizedRows) {
      if (!dates.includes(row.date)) dates.push(row.date);
    }
    const kept = new Set(dates.slice(0, days));

    const selected = normalizedRows.filter((row) => kept.has(row.date));
    const units = new Set(selected.map((row) => `${row.currency}:${row.measurement}:${row.source}`));
    if (units.size > 1)
      return {
        market: args.market,
        sessions: kept.size,
        currency: "",
        measurement: "mixed" as const,
        byInvestor: [],
        truncated: rows.length === MAX_ROWS,
        warning: "Cannot aggregate different currencies, measurements or sources. Review the individual rows below.",
      };
    const measurement = selected[0]?.measurement ?? "net_buying";
    const totals = new Map<InvestorType, number>();
    let currency = "";
    for (const row of normalizedRows) {
      if (!kept.has(row.date)) continue;
      totals.set(row.investorType, (totals.get(row.investorType) ?? 0) + row.netBuyValue);
      currency = row.currency;
    }

    const byInvestor: Array<{ investorType: InvestorType; netBuyValue: number }> = [];
    for (const [investorType, netBuyValue] of totals) byInvestor.push({ investorType, netBuyValue });
    byInvestor.sort((a, b) => b.netBuyValue - a.netBuyValue);
    return {
      market: args.market,
      sessions: kept.size,
      currency,
      measurement,
      byInvestor,
      truncated: rows.length === MAX_ROWS,
      warning: null,
    };
  },
});
