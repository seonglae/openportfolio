// The tenant gate. Every public function in this backend starts here.
//
// The invariant: a caller never says which tenant it is. `tenantId` is derived
// from the identity's membership rows or from the service key's own row, so
// there is no argument a client can set to reach another book. `tenantSlug` is
// accepted only to disambiguate a caller who belongs to several tenants, and it
// is checked against membership before it is believed.
//
// Rows fetched by document id are re-checked with `inTenant`, which reports a
// foreign row as missing rather than forbidden: "forbidden" would confirm that
// the id exists, which is itself a cross-tenant read.

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { type MemberRole, roleAtLeast } from "@openportfolio/domain";

export type Ctx = QueryCtx | MutationCtx;

export type TenantScope = {
  tenantId: Id<"tenants">;
  // null for a service key: a worker is not a person, and the audit log says so.
  userId: string | null;
  role: MemberRole;
  via: "identity" | "serviceKey" | "dev";
};

// The argument shape every public function spreads into its own validator.
// Note what is absent: there is no tenantId.
export type ScopeArgs = { serviceKey?: string; tenantSlug?: string };

export const NOT_FOUND = "not found";
const AUTH_REQUIRED = "auth required";
const HEX_RADIX = 16;
const HEX_WIDTH = 2;

const encoder = new TextEncoder();

// Only the hash is stored, so a dump of the serviceKeys table cannot be
// replayed against the deployment.
export async function hashServiceKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(HEX_RADIX).padStart(HEX_WIDTH, "0");
  return hex;
}

export async function getUserId(ctx: Ctx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

async function tenantBySlug(ctx: Ctx, slug: string): Promise<Doc<"tenants">> {
  const tenant = await ctx.db
    .query("tenants")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
  if (!tenant) throw new Error(NOT_FOUND);
  return tenant;
}

async function membership(ctx: Ctx, tenantId: Id<"tenants">, userId: string): Promise<Doc<"memberships"> | null> {
  return await ctx.db
    .query("memberships")
    .withIndex("by_tenant_user", (q) => q.eq("tenantId", tenantId).eq("userId", userId))
    .first();
}

async function scopeFromServiceKey(ctx: Ctx, args: ScopeArgs, serviceKey: string): Promise<TenantScope> {
  const keyHash = await hashServiceKey(serviceKey);
  const row = await ctx.db
    .query("serviceKeys")
    .withIndex("by_hash", (q) => q.eq("keyHash", keyHash))
    .first();
  if (!row || row.revokedAt) throw new Error(AUTH_REQUIRED);
  // A key is issued for one tenant. Naming a different one is not a routing
  // hint, it is an attempt, and it fails.
  if (args.tenantSlug) {
    const named = await tenantBySlug(ctx, args.tenantSlug);
    if (named._id !== row.tenantId) throw new Error(NOT_FOUND);
  }
  return { tenantId: row.tenantId, userId: null, role: row.role, via: "serviceKey" };
}

async function scopeFromIdentity(ctx: Ctx, args: ScopeArgs, userId: string): Promise<TenantScope> {
  if (args.tenantSlug) {
    const tenant = await tenantBySlug(ctx, args.tenantSlug);
    const member = await membership(ctx, tenant._id, userId);
    // Membership decides, not the argument. This is the line that makes the
    // slug safe to accept at all.
    if (!member) throw new Error(NOT_FOUND);
    return { tenantId: tenant._id, userId, role: member.role, via: "identity" };
  }
  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  if (rows.length === 0) throw new Error("this identity belongs to no tenant");
  if (rows.length > 1) throw new Error("ambiguous tenant: pass tenantSlug");
  return { tenantId: rows[0].tenantId, userId, role: rows[0].role, via: "identity" };
}

// Local development with no identity provider configured. Set
// OPENPORTFOLIO_DEV_TENANT to a slug and unauthenticated callers are scoped to
// it. Unset by default, because a multi-tenant backend that defaults to open is
// a multi-tenant backend with one tenant: everybody.
async function scopeFromDevTenant(ctx: Ctx): Promise<TenantScope> {
  const slug = process.env.OPENPORTFOLIO_DEV_TENANT;
  if (!slug) throw new Error(AUTH_REQUIRED);
  const tenant = await tenantBySlug(ctx, slug);
  return { tenantId: tenant._id, userId: null, role: "owner", via: "dev" };
}

export async function requireTenant(ctx: Ctx, args: ScopeArgs): Promise<TenantScope> {
  if (args.serviceKey) return await scopeFromServiceKey(ctx, args, args.serviceKey);
  const userId = await getUserId(ctx);
  if (userId) return await scopeFromIdentity(ctx, args, userId);
  return await scopeFromDevTenant(ctx);
}

export async function requireRole(ctx: Ctx, args: ScopeArgs, minimum: MemberRole): Promise<TenantScope> {
  const scope = await requireTenant(ctx, args);
  if (!roleAtLeast(scope.role, minimum)) throw new Error(`role ${scope.role} is below ${minimum}`);
  return scope;
}

// The second half of the invariant. Anything fetched by document id passes
// through here before it is read or written.
export function inTenant<T extends { tenantId: Id<"tenants"> }>(scope: TenantScope, doc: T | null): T {
  if (!doc || doc.tenantId !== scope.tenantId) throw new Error(NOT_FOUND);
  return doc;
}

// Who did it, for the audit log. A service key is a machine acting for a
// tenant, and conflating that with a person makes the log useless in exactly
// the situation it exists for.
export function actorOf(scope: TenantScope): { actor: string; actorType: "user" | "agent" } {
  if (scope.userId) return { actor: scope.userId, actorType: "user" };
  return { actor: `service:${scope.via}`, actorType: "agent" };
}
