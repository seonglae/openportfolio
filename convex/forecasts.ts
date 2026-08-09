import { v } from "convex/values";
import {
  AUTHOR_TYPES,
  BRIER_RANDOM_BASELINE,
  type CalibrationPoint,
  FORECAST_STATUSES,
  criterionSymbol,
  dueAt as horizonEnd,
  expectedCalibrationError,
  meanBrier,
  reliabilityBuckets,
  resolveFromObservation,
  resolveFromOutcome,
  validateForecast,
} from "@openportfolio/domain";
import { highestBy } from "@openportfolio/core";
import { internalMutation, mutation, query } from "./_generated/server";
import { inTenant, requireRole, requireTenant } from "./auth";
import { appendAudit } from "./audit";
import { literals } from "./validators";

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const DEFAULT_BUCKETS = 10;
const DEFAULT_RESOLVE_BATCH = 200;
const MS_PER_DAY = 86_400_000;

// A call, registered before the fact. The criterion and the horizon are what
// separate this from a remembered opinion: both are fixed at emit time and
// neither can be edited afterwards, which is why there is no `update` here.
export const emit = mutation({
  args: {
    subject: v.string(),
    probability: v.number(),
    horizonSec: v.number(),
    resolutionCriterion: v.string(),
    rationale: v.optional(v.string()),
    author: v.optional(v.string()),
    authorType: v.optional(literals(AUTHOR_TYPES)),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const problems = validateForecast({
      subject: args.subject,
      probability: args.probability,
      horizonSec: args.horizonSec,
      resolutionCriterion: args.resolutionCriterion,
    });
    if (problems.length > 0) throw new Error(problems.join("; "));

    const createdAt = Date.now();
    let author = args.author;
    if (!author) author = scope.userId ?? `service:${scope.via}`;
    let authorType = args.authorType;
    if (!authorType) {
      if (scope.userId) authorType = "user";
      else authorType = "agent";
    }

    const id = await ctx.db.insert("forecasts", {
      tenantId: scope.tenantId,
      subject: args.subject,
      probability: args.probability,
      horizonSec: args.horizonSec,
      resolutionCriterion: args.resolutionCriterion,
      rationale: args.rationale,
      author,
      authorType,
      status: "open",
      createdAt,
      dueAt: horizonEnd(createdAt, args.horizonSec),
    });
    await appendAudit(ctx, scope, {
      kind: "forecast.emitted",
      subject: args.subject,
      detail: `p=${args.probability} ${args.resolutionCriterion}`,
    });
    return { id, dueAt: horizonEnd(createdAt, args.horizonSec) };
  },
});

export const list = query({
  args: {
    status: v.optional(literals(FORECAST_STATUSES)),
    author: v.optional(v.string()),
    limit: v.optional(v.number()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    const limit = Math.min(args.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    if (args.author) {
      const author = args.author;
      const byAuthor = await ctx.db
        .query("forecasts")
        .withIndex("by_tenant_author", (q) => q.eq("tenantId", scope.tenantId).eq("author", author))
        .order("desc")
        .take(limit);
      if (!args.status) return byAuthor;
      return byAuthor.filter((row) => row.status === args.status);
    }
    if (args.status) {
      const status = args.status;
      return await ctx.db
        .query("forecasts")
        .withIndex("by_tenant_status_due", (q) => q.eq("tenantId", scope.tenantId).eq("status", status))
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("forecasts")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", scope.tenantId))
      .order("desc")
      .take(limit);
  },
});

// Open calls whose horizon has passed, with the symbol each one needs an
// observation for. The sync worker reads this to know which quotes to fetch;
// a null symbol means the criterion is prose and a human has to settle it.
export const listDue = query({
  args: {
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    const now = args.now ?? Date.now();
    const limit = Math.min(args.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const rows = await ctx.db
      .query("forecasts")
      .withIndex("by_tenant_status_due", (q) => q.eq("tenantId", scope.tenantId).eq("status", "open").lte("dueAt", now))
      .take(limit);
    return rows.map((row) => ({
      id: row._id,
      subject: row.subject,
      probability: row.probability,
      resolutionCriterion: row.resolutionCriterion,
      dueAt: row.dueAt,
      symbol: criterionSymbol(row.resolutionCriterion),
    }));
  },
});

// Settle one call. An explicit `outcome` wins over an observation: it is a
// human saying what happened, and the parser exists to save them the typing,
// not to overrule them.
export const settle = mutation({
  args: {
    forecastId: v.id("forecasts"),
    observedValue: v.optional(v.number()),
    outcome: v.optional(v.boolean()),
    note: v.optional(v.string()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const row = inTenant(scope, await ctx.db.get(args.forecastId));
    if (row.status !== "open") throw new Error(`forecast is already ${row.status}`);

    let resolution = null;
    if (args.outcome !== undefined) resolution = resolveFromOutcome(row.probability, args.outcome);
    else if (args.observedValue !== undefined) {
      resolution = resolveFromObservation(row.probability, row.resolutionCriterion, args.observedValue);
    }
    if (!resolution) {
      throw new Error("pass an outcome, or an observedValue for a machine-resolvable criterion");
    }

    const resolvedAt = Date.now();
    await ctx.db.patch(row._id, {
      status: "resolved",
      resolvedAt,
      outcome: resolution.outcome,
      brier: resolution.brier,
      observedValue: args.observedValue,
      resolutionNote: args.note,
    });
    await appendAudit(ctx, scope, {
      kind: "forecast.resolved",
      subject: row.subject,
      detail: `outcome=${resolution.outcome} brier=${resolution.brier.toFixed(4)}`,
    });
    return { outcome: resolution.outcome, brier: resolution.brier };
  },
});

// For a call whose criterion became unresolvable: the ticker was delisted, the
// event was cancelled. Dropped from the mean rather than scored as a miss, with
// the reason on the row so that dropping one cannot quietly become a habit.
export const voidForecast = mutation({
  args: {
    forecastId: v.id("forecasts"),
    reason: v.string(),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const row = inTenant(scope, await ctx.db.get(args.forecastId));
    if (row.status !== "open") throw new Error(`forecast is already ${row.status}`);
    await ctx.db.patch(row._id, { status: "void", resolvedAt: Date.now(), resolutionNote: args.reason });
    await appendAudit(ctx, scope, { kind: "forecast.voided", subject: row.subject, detail: args.reason });
    return { voided: true };
  },
});

// The track record. `n` is the number of scored calls, not the number emitted:
// open calls are not a record of anything yet, and void ones never will be.
export const calibration = query({
  args: {
    windowDays: v.optional(v.number()),
    author: v.optional(v.string()),
    buckets: v.optional(v.number()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    const rows = await ctx.db
      .query("forecasts")
      .withIndex("by_tenant_status_due", (q) => q.eq("tenantId", scope.tenantId).eq("status", "resolved"))
      .collect();

    let cutoff = 0;
    if (args.windowDays) cutoff = Date.now() - args.windowDays * MS_PER_DAY;

    const points: CalibrationPoint[] = [];
    const scores: number[] = [];
    for (const row of rows) {
      if (row.createdAt < cutoff) continue;
      if (args.author && row.author !== args.author) continue;
      if (row.outcome === undefined || row.brier === undefined) continue;
      points.push({ probability: row.probability, outcome: row.outcome });
      scores.push(row.brier);
    }

    const buckets = reliabilityBuckets(points, args.buckets ?? DEFAULT_BUCKETS);
    return {
      n: points.length,
      meanBrier: meanBrier(scores),
      expectedCalibrationError: expectedCalibrationError(buckets),
      randomBaseline: BRIER_RANDOM_BASELINE,
      buckets,
    };
  },
});

// The resolver cron.
//
// This is the one function in the backend that crosses tenants, and it is an
// internalMutation for exactly that reason: no client can reach it. It sweeps
// every book's due calls in one pass because a per-tenant cron would mean a
// cron per signup.
//
// An observation comes from the freshest balance row carrying a price for the
// symbol, which is what the sync worker keeps current. No observation means the
// call stays open rather than being scored on a guess.
export const resolveDue = internalMutation({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = args.limit ?? DEFAULT_RESOLVE_BATCH;
    const due = await ctx.db
      .query("forecasts")
      .withIndex("by_status_due", (q) => q.eq("status", "open").lte("dueAt", now))
      .take(limit);

    let resolved = 0;
    let unobserved = 0;
    let human = 0;

    for (const row of due) {
      const symbol = criterionSymbol(row.resolutionCriterion);
      if (!symbol) {
        human += 1;
        continue;
      }
      const priced = await ctx.db
        .query("balances")
        .withIndex("by_tenant_symbol", (q) => q.eq("tenantId", row.tenantId).eq("symbol", symbol))
        .collect();
      const withPrice = priced.filter((balance) => typeof balance.lastPrice === "number");
      const freshest = highestBy(withPrice, (balance) => balance.asOf);
      const observed = freshest?.lastPrice;
      if (observed === undefined) {
        unobserved += 1;
        continue;
      }
      const resolution = resolveFromObservation(row.probability, row.resolutionCriterion, observed);
      if (!resolution) {
        human += 1;
        continue;
      }
      await ctx.db.patch(row._id, {
        status: "resolved",
        resolvedAt: now,
        outcome: resolution.outcome,
        brier: resolution.brier,
        observedValue: observed,
        resolutionNote: `auto-resolved from ${freshest?.accountKey ?? "balances"} @ ${observed}`,
      });
      // Written inline rather than through appendAudit: the cron has no caller
      // and therefore no tenant scope, and inventing one would put a fake actor
      // in the only record of what the system did unattended.
      await ctx.db.insert("auditLog", {
        tenantId: row.tenantId,
        at: now,
        kind: "forecast.resolved",
        actor: "cron:resolver",
        actorType: "agent",
        subject: row.subject,
        detail: `outcome=${resolution.outcome} brier=${resolution.brier.toFixed(4)} observed=${observed}`,
      });
      resolved += 1;
    }

    return { seen: due.length, resolved, unobserved, human };
  },
});
