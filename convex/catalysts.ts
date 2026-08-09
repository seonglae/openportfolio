import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole, requireTenant } from "./auth";
import { appendAudit } from "./audit";

const DEFAULT_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;
const MAX_ROWS = 500;

// Dated forward events, kept as a calendar rather than discovered in a
// post-mortem. A lockup expiry, an index rebalance, an earnings date, a
// scheduled unlock: the forced seller is on a schedule, and the schedule is
// public.
export const add = mutation({
  args: {
    key: v.string(),
    title: v.string(),
    at: v.number(),
    assets: v.array(v.string()),
    venue: v.optional(v.string()),
    source: v.optional(v.string()),
    note: v.optional(v.string()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const existing = await ctx.db
      .query("catalysts")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", scope.tenantId).eq("key", args.key))
      .first();
    const now = Date.now();
    const fields = {
      title: args.title,
      at: args.at,
      assets: args.assets,
      venue: args.venue,
      source: args.source,
      note: args.note,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("catalysts", {
      tenantId: scope.tenantId,
      key: args.key,
      createdAt: now,
      ...fields,
    });
    await appendAudit(ctx, scope, { kind: "catalyst.added", subject: args.key, detail: args.assets.join(",") });
    return { id, created: true };
  },
});

export const upcoming = query({
  args: {
    windowDays: v.optional(v.number()),
    asset: v.optional(v.string()),
    now: v.optional(v.number()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    const now = args.now ?? Date.now();
    const until = now + (args.windowDays ?? DEFAULT_WINDOW_DAYS) * MS_PER_DAY;
    const rows = await ctx.db
      .query("catalysts")
      .withIndex("by_tenant_at", (q) => q.eq("tenantId", scope.tenantId).gte("at", now).lte("at", until))
      .take(MAX_ROWS);
    if (!args.asset) return rows;
    const asset = args.asset;
    return rows.filter((row) => row.assets.includes(asset));
  },
});

export const list = query({
  args: { serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    return await ctx.db
      .query("catalysts")
      .withIndex("by_tenant_at", (q) => q.eq("tenantId", scope.tenantId))
      .order("desc")
      .take(MAX_ROWS);
  },
});
