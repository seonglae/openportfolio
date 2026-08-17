import { v } from "convex/values";
import { MEMBER_ROLES } from "@openportfolio/domain";
import { mutation, query } from "./_generated/server";
import { getUserId, hashServiceKey, requireRole, requireTenant } from "./auth";
import { appendAudit } from "./audit";
import { literals } from "./validators";

const MEMBER_ROLE = literals(MEMBER_ROLES);
// Long enough that guessing is not a strategy. `openssl rand -hex 32` gives 64.
const MIN_SERVICE_KEY_LENGTH = 32;

// The signup path. An authenticated caller creates a tenant and becomes its
// owner. With no identity provider configured, the only slug that can be
// created is the one OPENPORTFOLIO_DEV_TENANT names, which is what lets a fresh
// localhost checkout get its first book without configuring anything.
//
// After the first book exists, this closes. A self-hosted deployment reachable
// from the internet has an open sign-up form on it -- Convex Auth will happily
// create an account for anyone who finds the URL -- and while the tenant gate
// means a stranger could never read your book, they could create their own
// inside your deployment and spend your quota. So a caller who already belongs
// to a tenant may make another, and a caller who belongs to none may only make
// the very first one. `OPENPORTFOLIO_OPEN_SIGNUP=1` reopens it for a deployment
// meant to serve several households.
export const create = mutation({
  args: { slug: v.string(), name: v.string(), baseCurrency: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (existing) throw new Error(`tenant "${args.slug}" already exists`);

    const userId = await getUserId(ctx);
    const devSlug = process.env.OPENPORTFOLIO_DEV_TENANT;
    if (!userId && devSlug !== args.slug) throw new Error("auth required");

    if (process.env.OPENPORTFOLIO_OPEN_SIGNUP !== "1") {
      const anyTenant = await ctx.db.query("tenants").first();
      if (anyTenant !== null && userId !== null) {
        const mine = await ctx.db
          .query("memberships")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .first();
        if (mine === null) throw new Error("sign-ups are closed on this deployment");
      }
    }

    const now = Date.now();
    const tenantId = await ctx.db.insert("tenants", {
      slug: args.slug,
      name: args.name,
      baseCurrency: args.baseCurrency,
      createdAt: now,
      updatedAt: now,
    });
    if (userId) {
      await ctx.db.insert("memberships", { tenantId, userId, role: "owner", createdAt: now });
    }
    await ctx.db.insert("auditLog", {
      tenantId,
      at: now,
      kind: "tenant.created",
      actor: userId ?? "service:dev",
      actorType: userId ? "user" : "agent",
      subject: args.slug,
    });
    return { tenantId, slug: args.slug };
  },
});

// What the caller is, resolved the same way every other function resolves it.
// The first thing to check when a call is being rejected.
export const whoami = query({
  args: { serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    const tenant = await ctx.db.get(scope.tenantId);
    return {
      tenantSlug: tenant?.slug ?? null,
      tenantName: tenant?.name ?? null,
      baseCurrency: tenant?.baseCurrency ?? null,
      userId: scope.userId,
      role: scope.role,
      via: scope.via,
    };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const out: Array<{ slug: string; name: string; role: string }> = [];
    for (const row of rows) {
      const tenant = await ctx.db.get(row.tenantId);
      if (tenant) out.push({ slug: tenant.slug, name: tenant.name, role: row.role });
    }
    return out;
  },
});

export const listMembers = query({
  args: { serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "admin");
    return await ctx.db
      .query("memberships")
      .withIndex("by_tenant", (q) => q.eq("tenantId", scope.tenantId))
      .collect();
  },
});

export const addMember = mutation({
  args: {
    userId: v.string(),
    role: MEMBER_ROLE,
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "admin");
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_tenant_user", (q) => q.eq("tenantId", scope.tenantId).eq("userId", args.userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role });
      await appendAudit(ctx, scope, { kind: "member.added", subject: args.userId, detail: args.role });
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("memberships", {
      tenantId: scope.tenantId,
      userId: args.userId,
      role: args.role,
      invitedBy: scope.userId ?? undefined,
      createdAt: Date.now(),
    });
    await appendAudit(ctx, scope, { kind: "member.added", subject: args.userId, detail: args.role });
    return { id, created: true };
  },
});

export const removeMember = mutation({
  args: { userId: v.string(), serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "admin");
    const row = await ctx.db
      .query("memberships")
      .withIndex("by_tenant_user", (q) => q.eq("tenantId", scope.tenantId).eq("userId", args.userId))
      .first();
    if (!row) return { removed: false };
    // A tenant with no owner is a tenant nobody can administer.
    if (row.role === "owner") {
      const owners = await ctx.db
        .query("memberships")
        .withIndex("by_tenant", (q) => q.eq("tenantId", scope.tenantId))
        .collect();
      const remaining = owners.filter((m) => m.role === "owner" && m._id !== row._id);
      if (remaining.length === 0) throw new Error("cannot remove the last owner");
    }
    await ctx.db.delete(row._id);
    await appendAudit(ctx, scope, { kind: "member.removed", subject: args.userId });
    return { removed: true };
  },
});

// The key itself is generated by the operator (`openssl rand -hex 32`) and only
// its hash is sent here. Nothing on the deployment ever holds the secret, and
// nothing in a response log can leak it.
export const issueServiceKey = mutation({
  args: {
    key: v.string(),
    label: v.string(),
    role: v.optional(MEMBER_ROLE),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "admin");
    if (args.key.length < MIN_SERVICE_KEY_LENGTH) {
      throw new Error(`service key must be at least ${MIN_SERVICE_KEY_LENGTH} characters`);
    }
    const keyHash = await hashServiceKey(args.key);
    const clash = await ctx.db
      .query("serviceKeys")
      .withIndex("by_hash", (q) => q.eq("keyHash", keyHash))
      .first();
    if (clash) throw new Error("that key is already issued");
    const id = await ctx.db.insert("serviceKeys", {
      tenantId: scope.tenantId,
      keyHash,
      label: args.label,
      role: args.role ?? "member",
      createdAt: Date.now(),
    });
    await appendAudit(ctx, scope, { kind: "serviceKey.issued", subject: args.label });
    return { id, label: args.label };
  },
});

export const revokeServiceKey = mutation({
  args: { label: v.string(), serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "admin");
    const rows = await ctx.db
      .query("serviceKeys")
      .withIndex("by_tenant", (q) => q.eq("tenantId", scope.tenantId))
      .collect();
    let revoked = 0;
    for (const row of rows) {
      if (row.label !== args.label || row.revokedAt) continue;
      await ctx.db.patch(row._id, { revokedAt: Date.now() });
      revoked += 1;
    }
    if (revoked > 0) await appendAudit(ctx, scope, { kind: "serviceKey.revoked", subject: args.label });
    return { revoked };
  },
});

// Hashes and timestamps only. There is nothing here to replay.
export const listServiceKeys = query({
  args: { serviceKey: v.optional(v.string()), tenantSlug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "admin");
    const rows = await ctx.db
      .query("serviceKeys")
      .withIndex("by_tenant", (q) => q.eq("tenantId", scope.tenantId))
      .collect();
    return rows.map((row) => ({
      label: row.label,
      role: row.role,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
    }));
  },
});
