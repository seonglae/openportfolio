import { v } from "convex/values";
import { ACCOUNT_KINDS } from "@openportfolio/domain";
import { mutation, query } from "./_generated/server";
import { requireRole, requireTenant } from "./auth";
import { appendAudit } from "./audit";
import { literals } from "./validators";

// The registry the dashboard reads to decide what a venue is allowed to show.
// The flags are written by whatever runs the adapter, so they describe the
// adapter that exists rather than the one someone meant to write.
export const register = mutation({
  args: {
    venue: v.string(),
    label: v.string(),
    kind: literals(ACCOUNT_KINDS),
    canReadBalances: v.boolean(),
    canReadQuotes: v.boolean(),
    canPlaceOrders: v.boolean(),
    notes: v.optional(v.string()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const existing = await ctx.db
      .query("venues")
      .withIndex("by_tenant_venue", (q) => q.eq("tenantId", scope.tenantId).eq("venue", args.venue))
      .first();
    const row = {
      tenantId: scope.tenantId,
      venue: args.venue,
      label: args.label,
      kind: args.kind,
      canReadBalances: args.canReadBalances,
      canReadQuotes: args.canReadQuotes,
      canPlaceOrders: args.canPlaceOrders,
      notes: args.notes,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, row);
      await appendAudit(ctx, scope, { kind: "venue.registered", subject: args.venue, detail: "updated" });
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("venues", row);
    await appendAudit(ctx, scope, { kind: "venue.registered", subject: args.venue });
    return { id, created: true };
  },
});

export const list = query({
  args: { serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    return await ctx.db
      .query("venues")
      .withIndex("by_tenant", (q) => q.eq("tenantId", scope.tenantId))
      .collect();
  },
});

export const get = query({
  args: { venue: v.string(), serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    return await ctx.db
      .query("venues")
      .withIndex("by_tenant_venue", (q) => q.eq("tenantId", scope.tenantId).eq("venue", args.venue))
      .first();
  },
});
