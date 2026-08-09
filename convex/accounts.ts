import { v } from "convex/values";
import { ACCOUNT_KINDS } from "@openportfolio/domain";
import { mutation, query } from "./_generated/server";
import { requireRole, requireTenant } from "./auth";
import { appendAudit } from "./audit";
import { literals } from "./validators";

// `accountKey` is the operator's own stable name for the account, not a
// document id. Balances hang off it so re-linking an account keeps its history
// instead of orphaning it.
export const link = mutation({
  args: {
    accountKey: v.string(),
    venue: v.string(),
    kind: literals(ACCOUNT_KINDS),
    label: v.string(),
    currency: v.string(),
    note: v.optional(v.string()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", scope.tenantId).eq("accountKey", args.accountKey))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        venue: args.venue,
        kind: args.kind,
        label: args.label,
        currency: args.currency,
        note: args.note,
        active: true,
        updatedAt: now,
      });
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("accounts", {
      tenantId: scope.tenantId,
      accountKey: args.accountKey,
      venue: args.venue,
      kind: args.kind,
      label: args.label,
      currency: args.currency,
      active: true,
      note: args.note,
      createdAt: now,
      updatedAt: now,
    });
    await appendAudit(ctx, scope, { kind: "account.linked", subject: args.accountKey, detail: args.venue });
    return { id, created: true };
  },
});

// Deactivated, not deleted. The balances stay, so past snapshots keep adding up
// to what they said at the time.
export const unlink = mutation({
  args: { accountKey: v.string(), serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const row = await ctx.db
      .query("accounts")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", scope.tenantId).eq("accountKey", args.accountKey))
      .first();
    if (!row) return { unlinked: false };
    await ctx.db.patch(row._id, { active: false, updatedAt: Date.now() });
    await appendAudit(ctx, scope, { kind: "account.unlinked", subject: args.accountKey });
    return { unlinked: true };
  },
});

export const list = query({
  args: {
    includeInactive: v.optional(v.boolean()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    const rows = await ctx.db
      .query("accounts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", scope.tenantId))
      .collect();
    if (args.includeInactive) return rows;
    return rows.filter((row) => row.active);
  },
});

export const get = query({
  args: { accountKey: v.string(), serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    return await ctx.db
      .query("accounts")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", scope.tenantId).eq("accountKey", args.accountKey))
      .first();
  },
});
