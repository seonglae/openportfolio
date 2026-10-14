import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  AUTHOR_TYPES,
  BRIER_RANDOM_BASELINE,
  type CalibrationPoint,
  FORECAST_STATUSES,
  criterionSymbol,
  dueAt as horizonEnd,
  expectedCalibrationError,
  isMachineSettleable,
  meanBrier,
  reliabilityBuckets,
  resolveFromObservation,
  resolveFromOutcome,
  validateForecast,
  validateEvidence,
  pairedBrierComparison,
} from "@openportfolio/domain";
import { resolutionTarget, resolutionEvidence } from "./forecastValidators";
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
    resolutionTarget: v.optional(resolutionTarget),
    baselineProbability: v.optional(v.number()),
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
      resolutionTarget: args.resolutionTarget,
      baselineProbability: args.baselineProbability,
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
      resolutionTarget: args.resolutionTarget,
      baselineProbability: args.baselineProbability,
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

// Open calls whose horizon has passed. requiresHistoricalEvidence marks the
// ones the sync worker settles from a supported target; every other row,
// prose or ticker-only or an unsupported target, needs a reader.
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
      resolutionTarget: row.resolutionTarget,
      requiresHistoricalEvidence: isMachineSettleable(row.resolutionTarget),
    }));
  },
});

// Cursor pagination prevents old unsupported calls from starving newer calls.
// The worker pins now across pages so concurrent emissions cannot extend a run.
export const listDuePage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    now: v.number(),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireTenant(ctx, args);
    const result = await ctx.db
      .query("forecasts")
      .withIndex("by_tenant_status_due", (q) =>
        q.eq("tenantId", scope.tenantId).eq("status", "open").lte("dueAt", args.now),
      )
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((row) => ({
        id: row._id,
        subject: row.subject,
        probability: row.probability,
        dueAt: row.dueAt,
        resolutionTarget: row.resolutionTarget,
      })),
    };
  },
});

// Evidence-bound and manual resolutions are distinct, mutually exclusive paths.
export const settle = mutation({
  args: {
    forecastId: v.id("forecasts"),
    observedValue: v.optional(v.number()),
    evidence: v.optional(resolutionEvidence),
    outcome: v.optional(v.boolean()),
    note: v.optional(v.string()),
    serviceKey: v.optional(v.string()),
    tenantSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireRole(ctx, args, "member");
    const row = inTenant(scope, await ctx.db.get(args.forecastId));
    if (row.status !== "open") throw new Error(`forecast is already ${row.status}`);

    const resolvedAt = Date.now();
    if (resolvedAt < row.dueAt) throw new Error("forecast horizon has not passed");
    if (args.outcome !== undefined && (args.observedValue !== undefined || args.evidence !== undefined)) {
      throw new Error("pass either an outcome or an observation with evidence, never both");
    }
    if (args.outcome !== undefined) {
      if (isMachineSettleable(row.resolutionTarget)) {
        throw new Error("this forecast requires matching historical evidence");
      }
      if (!args.note?.trim()) throw new Error("manual resolution requires a note naming the evidence source");
    }
    if (args.observedValue !== undefined) validateEvidence(row.resolutionTarget, args.evidence, row.dueAt, resolvedAt);
    let resolution = null;
    if (args.outcome !== undefined) resolution = resolveFromOutcome(row.probability, args.outcome);
    else if (args.observedValue !== undefined) {
      resolution = resolveFromObservation(row.probability, row.resolutionCriterion, args.observedValue);
    }
    if (!resolution) {
      throw new Error("pass an outcome, or an observedValue for a machine-resolvable criterion");
    }

    await ctx.db.patch(row._id, {
      status: "resolved",
      resolvedAt,
      outcome: resolution.outcome,
      brier: resolution.brier,
      observedValue: args.observedValue,
      resolutionNote: args.note,
      resolutionEvidence: args.evidence,
      resolutionMethod: args.outcome === undefined ? "evidence" : "manual",
    });
    await appendAudit(ctx, scope, {
      kind: "forecast.resolved",
      subject: row.subject,
      detail: JSON.stringify({
        forecastId: row._id,
        outcome: resolution.outcome,
        brier: resolution.brier,
        dueAt: row.dueAt,
        evidence: args.evidence,
        note: args.note,
      }),
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
    if (!args.reason.trim()) throw new Error("void reason is required");
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
    if (args.windowDays !== undefined && (!Number.isFinite(args.windowDays) || args.windowDays <= 0)) {
      throw new Error("windowDays must be positive and finite");
    }
    let cutoff = 0;
    if (args.windowDays) cutoff = Date.now() - args.windowDays * MS_PER_DAY;
    // Read only the rows the window and author can count, from their index.
    let rows;
    if (args.author) {
      const author = args.author;
      rows = await ctx.db
        .query("forecasts")
        .withIndex("by_tenant_author", (q) => q.eq("tenantId", scope.tenantId).eq("author", author))
        .collect();
    } else {
      rows = await ctx.db
        .query("forecasts")
        .withIndex("by_tenant_created", (q) => q.eq("tenantId", scope.tenantId).gte("createdAt", cutoff))
        .collect();
    }

    const points: CalibrationPoint[] = [];
    const scores: number[] = [];
    const paired: Array<CalibrationPoint & { baselineProbability: number }> = [];
    let open = 0;
    let voided = 0;
    let legacyResolved = 0;
    for (const row of rows) {
      if (row.createdAt < cutoff) continue;
      if (args.author && row.author !== args.author) continue;
      if (row.status === "open") {
        open += 1;
        continue;
      }
      if (row.status === "void") {
        voided += 1;
        continue;
      }
      if (!row.resolutionMethod) {
        legacyResolved += 1;
        continue;
      }
      if (row.outcome === undefined || row.brier === undefined) continue;
      if (row.baselineProbability !== undefined) {
        paired.push({
          probability: row.probability,
          outcome: row.outcome,
          baselineProbability: row.baselineProbability,
        });
      }
      points.push({ probability: row.probability, outcome: row.outcome });
      scores.push(row.brier);
    }

    const buckets = reliabilityBuckets(points, args.buckets ?? DEFAULT_BUCKETS);
    return {
      n: points.length,
      open,
      voided,
      legacyResolved,
      paired: pairedBrierComparison(paired),
      observedBaseRate: meanBrier(points.map((p) => Number(p.outcome))),
      baseRateBenchmark: "in-sample descriptive only; not evidence of forecasting skill",
      confidenceInterval: null,
      confidenceIntervalReason: "Event dependence is unknown; no independence-based interval is claimed.",
      meanBrier: meanBrier(scores),
      expectedCalibrationError: expectedCalibrationError(buckets),
      randomBaseline: BRIER_RANDOM_BASELINE,
      buckets,
    };
  },
});

// A balance is a current valuation, not historical settlement evidence. Keep
// the cron API for existing deployments, but never infer an outcome from it.
// Historical evidence enters through settle, under the tenant gate and audit.
export const resolveDue = internalMutation({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = args.limit ?? DEFAULT_RESOLVE_BATCH;
    const due = await ctx.db
      .query("forecasts")
      .withIndex("by_status_due", (q) => q.eq("status", "open").lte("dueAt", now))
      .take(limit);
    const human = due.filter((row) => !criterionSymbol(row.resolutionCriterion)).length;
    return { seen: due.length, resolved: 0, unobserved: due.length - human, human };
  },
});
