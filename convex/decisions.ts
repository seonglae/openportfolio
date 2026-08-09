import { v } from "convex/values";
import { DECISION_STATUSES } from "@openportfolio/domain";
import { mutation, query } from "./_generated/server";
import { inTenant, requireRole, requireTenant } from "./auth";
import { appendAudit } from "./audit";
import { literals } from "./validators";

const MAX_ROWS = 500;

// The deferred-decision queue.
//
// "Wait for the print, then decide" is a conclusion with an expiry. Said out
// loud it evaporates; written here it has a trigger condition, a status and an
// outcome, and it shows up on the board until one of those changes. This table
// exists because the alternative is a recommendation that was quietly dropped
// and remembered, later, as never having been made.
export const open = mutation({
  args: {
    key: v.string(),
    title: v.string(),
    triggerCondition: v.string(),
    detail: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const existing = await ctx.db
      .query("decisions")
      .withIndex("by_tenant_key", (q) => q.eq("tenantId", scope.tenantId).eq("key", args.key))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        triggerCondition: args.triggerCondition,
        detail: args.detail,
        dueAt: args.dueAt,
        updatedAt: now,
      });
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("decisions", {
      tenantId: scope.tenantId,
      key: args.key,
      title: args.title,
      triggerCondition: args.triggerCondition,
      detail: args.detail,
      dueAt: args.dueAt,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    await appendAudit(ctx, scope, { kind: "decision.opened", subject: args.key, detail: args.triggerCondition });
    return { id, created: true };
  },
});

// Closing requires saying what happened. A decision closed with no outcome is
// a decision that was abandoned, and the queue should be able to tell the
// difference next month.
export const close = mutation({
  args: {
    key: v.string(),
    outcome: v.string(),
    status: v.optional(literals(DECISION_STATUSES)),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const row = inTenant(
      scope,
      await ctx.db
        .query("decisions")
        .withIndex("by_tenant_key", (q) => q.eq("tenantId", scope.tenantId).eq("key", args.key))
        .first(),
    );
    if (row.status !== "open") throw new Error(`decision is already ${row.status}`);
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: args.status ?? "done",
      outcome: args.outcome,
      resolvedAt: now,
      updatedAt: now,
    });
    await appendAudit(ctx, scope, { kind: "decision.closed", subject: args.key, detail: args.outcome });
    return { closed: true };
  },
});

export const list = query({
  args: {
    status: v.optional(literals(DECISION_STATUSES)),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    if (args.status) {
      const status = args.status;
      return await ctx.db
        .query("decisions")
        .withIndex("by_tenant_status", (q) => q.eq("tenantId", scope.tenantId).eq("status", status))
        .take(MAX_ROWS);
    }
    return await ctx.db
      .query("decisions")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", scope.tenantId))
      .take(MAX_ROWS);
  },
});

// Open decisions past their date. These are the ones that were going to be
// revisited and were not.
export const overdue = query({
  args: { now: v.optional(v.number()), serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    const now = args.now ?? Date.now();
    const rows = await ctx.db
      .query("decisions")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", scope.tenantId).eq("status", "open"))
      .take(MAX_ROWS);
    return rows.filter((row) => row.dueAt !== undefined && row.dueAt <= now);
  },
});
