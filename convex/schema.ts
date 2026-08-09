import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  ACCOUNT_KINDS,
  ASSET_CLASSES,
  AUDIT_KINDS,
  AUTHOR_TYPES,
  DECISION_STATUSES,
  FORECAST_STATUSES,
  INVESTOR_TYPES,
  MEMBER_ROLES,
} from "@openportfolio/domain";
import { literals } from "./validators";

// THE TENANT INVARIANT
//
// Every table except `tenants` itself carries `tenantId`, and every index on
// those tables leads with it. That is not decoration: a query that forgets the
// scope cannot use any of these indexes, so it either fails to compile against
// the index name or degrades into a full scan that review will catch. The gate
// in auth.ts derives `tenantId` from the caller's identity or service key and
// never from an argument, so there is no request shape that can ask for another
// tenant's rows.
//
// The one deliberate exception is `forecasts.by_status_due`, which omits the
// tenant so the resolver cron can sweep every tenant's due calls in one pass.
// It is reachable only from an internalMutation. See forecasts.ts.

const ACCOUNT_KIND = literals(ACCOUNT_KINDS);
const ASSET_CLASS = literals(ASSET_CLASSES);
const MEMBER_ROLE = literals(MEMBER_ROLES);

export default defineSchema({
  // A tenant is one book: one household, one desk, one fund. It owns every
  // other row in the deployment.
  tenants: defineTable({
    slug: v.string(),
    name: v.string(),
    // Everything aggregates into this. Per-account currencies stay as they are
    // and are converted at read time by whoever wrote the row.
    baseCurrency: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  memberships: defineTable({
    tenantId: v.id("tenants"),
    // The identity provider's subject claim, not an email: emails get reused
    // and rewritten, subjects do not.
    userId: v.string(),
    role: MEMBER_ROLE,
    invitedBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_tenant_user", ["tenantId", "userId"])
    // How the gate answers "which tenant is this caller" without being told.
    .index("by_user", ["userId"])
    .index("by_tenant", ["tenantId"]),

  // A headless worker has no session, so it presents a key. One key maps to
  // exactly one tenant, which is what keeps a compromised worker inside the
  // blast radius of the book it was issued for. Only the hash is stored.
  serviceKeys: defineTable({
    tenantId: v.id("tenants"),
    keyHash: v.string(),
    label: v.string(),
    role: MEMBER_ROLE,
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_hash", ["keyHash"])
    .index("by_tenant", ["tenantId"]),

  // What each connected venue can actually do, declared by its adapter rather
  // than assumed by the UI. A venue that cannot read balances is a data source,
  // not an account, and the dashboard has to say so.
  venues: defineTable({
    tenantId: v.id("tenants"),
    venue: v.string(),
    label: v.string(),
    kind: ACCOUNT_KIND,
    canReadBalances: v.boolean(),
    canReadQuotes: v.boolean(),
    // False everywhere by default. Execution is opt-in per venue and still
    // requires a human confirmation on the order itself.
    canPlaceOrders: v.boolean(),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_tenant_venue", ["tenantId", "venue"])
    .index("by_tenant", ["tenantId"]),

  accounts: defineTable({
    tenantId: v.id("tenants"),
    // Operator-chosen, stable across syncs. Balances hang off this rather than
    // off the document id so a re-linked account keeps its history.
    accountKey: v.string(),
    venue: v.string(),
    kind: ACCOUNT_KIND,
    label: v.string(),
    currency: v.string(),
    active: v.boolean(),
    syncedAt: v.optional(v.number()),
    note: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant_key", ["tenantId", "accountKey"])
    .index("by_tenant_venue", ["tenantId", "venue"])
    .index("by_tenant", ["tenantId"]),

  balances: defineTable({
    tenantId: v.id("tenants"),
    accountKey: v.string(),
    symbol: v.string(),
    assetClass: ASSET_CLASS,
    qty: v.number(),
    lastPrice: v.optional(v.number()),
    valueLocal: v.number(),
    // Converted at write time, with the rate kept alongside it. A snapshot that
    // recomputes historical values at today's rate is a rewritten past.
    valueBase: v.number(),
    fxRate: v.optional(v.number()),
    currency: v.string(),
    costBasis: v.optional(v.number()),
    pnl: v.optional(v.number()),
    asOf: v.number(),
  })
    .index("by_tenant_account_symbol", ["tenantId", "accountKey", "symbol"])
    .index("by_tenant_account", ["tenantId", "accountKey"])
    .index("by_tenant_symbol", ["tenantId", "symbol"])
    .index("by_tenant", ["tenantId"]),

  netWorthSnapshots: defineTable({
    tenantId: v.id("tenants"),
    at: v.number(),
    baseCurrency: v.string(),
    totalBase: v.number(),
    byVenue: v.array(v.object({ venue: v.string(), valueBase: v.number() })),
    byAssetClass: v.array(v.object({ assetClass: ASSET_CLASS, valueBase: v.number() })),
    accountCount: v.number(),
  }).index("by_tenant_at", ["tenantId", "at"]),

  // Every call, registered before the fact with the condition that settles it.
  forecasts: defineTable({
    tenantId: v.id("tenants"),
    subject: v.string(),
    probability: v.number(),
    horizonSec: v.number(),
    // "BTCUSDT > 100000" resolves itself. Prose does not, and is resolved by a
    // human instead of being guessed at.
    resolutionCriterion: v.string(),
    rationale: v.optional(v.string()),
    author: v.string(),
    authorType: literals(AUTHOR_TYPES),
    status: literals(FORECAST_STATUSES),
    createdAt: v.number(),
    dueAt: v.number(),
    resolvedAt: v.optional(v.number()),
    outcome: v.optional(v.boolean()),
    observedValue: v.optional(v.number()),
    brier: v.optional(v.number()),
    resolutionNote: v.optional(v.string()),
  })
    .index("by_tenant_created", ["tenantId", "createdAt"])
    .index("by_tenant_status_due", ["tenantId", "status", "dueAt"])
    .index("by_tenant_author", ["tenantId", "author"])
    // Tenant-less on purpose: the resolver cron sweeps every book at once and
    // is an internalMutation, unreachable from any client. Nothing else may use
    // this index.
    .index("by_status_due", ["status", "dueAt"]),

  // Who bought and who was made to sell. One row per market (or symbol) per day
  // per investor type.
  flows: defineTable({
    tenantId: v.id("tenants"),
    market: v.string(),
    symbol: v.optional(v.string()),
    // YYYY-MM-DD session date, not an instant: flow is published per session,
    // and an epoch would invite timezone drift into a daily series.
    date: v.string(),
    investorType: literals(INVESTOR_TYPES),
    netBuyValue: v.number(),
    turnoverValue: v.optional(v.number()),
    currency: v.string(),
    source: v.string(),
    createdAt: v.number(),
  })
    .index("by_tenant_market_date", ["tenantId", "market", "date"])
    .index("by_tenant_symbol_date", ["tenantId", "symbol", "date"])
    .index("by_tenant_date", ["tenantId", "date"]),

  // The deferred-decision queue. "Wait until the Fed meets" is a conclusion
  // with an expiry, and a conclusion with an expiry that nobody wrote down is a
  // conclusion that gets dropped.
  decisions: defineTable({
    tenantId: v.id("tenants"),
    key: v.string(),
    title: v.string(),
    detail: v.optional(v.string()),
    triggerCondition: v.string(),
    status: literals(DECISION_STATUSES),
    dueAt: v.optional(v.number()),
    outcome: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_tenant_key", ["tenantId", "key"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_due", ["tenantId", "dueAt"]),

  catalysts: defineTable({
    tenantId: v.id("tenants"),
    key: v.string(),
    title: v.string(),
    at: v.number(),
    assets: v.array(v.string()),
    venue: v.optional(v.string()),
    source: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant_at", ["tenantId", "at"])
    .index("by_tenant_key", ["tenantId", "key"]),

  // Append-only. Nothing patches a row here, and nothing deletes one. It is the
  // only record of what the system did on its own.
  auditLog: defineTable({
    tenantId: v.id("tenants"),
    at: v.number(),
    kind: literals(AUDIT_KINDS),
    actor: v.string(),
    actorType: literals(AUTHOR_TYPES),
    subject: v.optional(v.string()),
    detail: v.optional(v.string()),
  })
    .index("by_tenant_at", ["tenantId", "at"])
    .index("by_tenant_kind", ["tenantId", "kind"]),
});
