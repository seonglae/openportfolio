import { v } from "convex/values";
import { AUDIT_KINDS, type AuditKind } from "@openportfolio/domain";
import { type MutationCtx, query } from "./_generated/server";
import { type TenantScope, actorOf, requireTenant } from "./auth";
import { literals } from "./validators";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// Called by every state-changing mutation in this backend. Insert only: there
// is no patch and no delete anywhere in this file, and adding one would remove
// the only record of what the system did on its own.
export async function appendAudit(
  ctx: MutationCtx,
  scope: TenantScope,
  entry: { kind: AuditKind; subject?: string; detail?: string },
): Promise<void> {
  const { actor, actorType } = actorOf(scope);
  await ctx.db.insert("auditLog", {
    tenantId: scope.tenantId,
    at: Date.now(),
    kind: entry.kind,
    actor,
    actorType,
    subject: entry.subject,
    detail: entry.detail,
  });
}

export const list = query({
  args: {
    kind: v.optional(literals(AUDIT_KINDS)),
    limit: v.optional(v.number()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    if (args.kind) {
      const kind = args.kind;
      return await ctx.db
        .query("auditLog")
        .withIndex("by_tenant_kind", (q) => q.eq("tenantId", scope.tenantId).eq("kind", kind))
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("auditLog")
      .withIndex("by_tenant_at", (q) => q.eq("tenantId", scope.tenantId))
      .order("desc")
      .take(limit);
  },
});
