// The rules a forecast lives by, kept out of Convex so they can be tested
// without a backend and reused by the workers and the MCP server.

import { brierScore, isProbability } from "./brier.ts";
import type { AssetClass } from "./enums.ts";
import { evaluateCriterion, parseCriterion } from "./criterion.ts";

const MS_PER_SEC = 1000;
// An hour is the shortest horizon worth registering: below that the resolver
// cron cannot even observe the window, and the call is a reflex rather than a
// forecast. Five years is the far end, past which nobody is holding anyone to
// anything.
export const MIN_HORIZON_SEC = 3600;
export const MINUTE_MS = 60_000;
export const MAX_OBSERVATION_AGE_MS = 4 * 24 * 3600 * 1000;
export const MAX_HORIZON_SEC = 5 * 365 * 24 * 3600;

export type ForecastDraft = {
  subject: string;
  probability: number;
  horizonSec: number;
  resolutionCriterion: string;
  resolutionTarget?: ResolutionTarget;
  baselineProbability?: number;
};

export function dueAt(createdAt: number, horizonSec: number): number {
  return createdAt + horizonSec * MS_PER_SEC;
}

export function isDue(due: number, now: number): boolean {
  return now >= due;
}

// Returns the list of problems rather than throwing on the first one, so a
// caller can show all of them at once instead of a game of whack-a-mole.
export function validateForecast(draft: ForecastDraft): string[] {
  const problems: string[] = [];
  if (draft.subject.trim().length === 0) problems.push("subject is empty");
  if (!isProbability(draft.probability)) problems.push(`probability out of range: ${draft.probability}`);
  if (draft.resolutionCriterion.trim().length === 0) problems.push("resolutionCriterion is empty");
  if (draft.horizonSec < MIN_HORIZON_SEC) problems.push(`horizonSec below ${MIN_HORIZON_SEC}`);
  if (draft.horizonSec > MAX_HORIZON_SEC) problems.push(`horizonSec above ${MAX_HORIZON_SEC}`);
  if (!Number.isFinite(draft.horizonSec)) problems.push("horizonSec must be finite");
  if (draft.baselineProbability !== undefined && !isProbability(draft.baselineProbability)) {
    problems.push("baselineProbability out of range");
  }
  if (draft.resolutionTarget) {
    const target = draft.resolutionTarget;
    if (target.observationPolicy === "last_completed_minute") {
      if (target.priceBasis !== "provider_close" || target.sessions !== "all") {
        problems.push("minute-close resolution requires provider_close price basis and all sessions");
      }
      if (
        !Number.isInteger(target.maxAgeMs) ||
        (target.maxAgeMs ?? 0) < MINUTE_MS ||
        (target.maxAgeMs ?? Infinity) > MAX_OBSERVATION_AGE_MS
      ) {
        problems.push("minute-close resolution requires maxAgeMs from one minute to four days");
      }
      if (
        target.venue !== "yahoo" ||
        target.assetId !== `yahoo:${target.symbol}` ||
        !["equity", "etf"].includes(target.assetClass)
      ) {
        problems.push("minute-close resolution supports exact Yahoo equity and ETF identifiers only");
      }
    } else if (target.maxAgeMs !== undefined) {
      problems.push("maxAgeMs is only valid for last_completed_minute");
    }
    const criterion = parseCriterion(draft.resolutionCriterion);
    if (!criterion || criterion.symbol !== target.symbol) problems.push("resolutionTarget must match criterion symbol");
    if ([target.assetId, target.venue, target.currency].some((s) => !s.trim() || s !== s.trim())) {
      problems.push("resolutionTarget needs an exact assetId, venue and currency");
    }
  }
  return problems;
}

export type Resolution = { outcome: boolean; brier: number };

// Machine resolution. Null means "this criterion is not the parseable kind",
// which is a different answer from "the criterion was not met" and must not
// collapse into it: scoring an unparsed criterion as a miss would quietly
// punish every prose forecast.
export function resolveFromObservation(
  probability: number,
  resolutionCriterion: string,
  observed: number,
): Resolution | null {
  if (!Number.isFinite(observed)) return null;
  const criterion = parseCriterion(resolutionCriterion);
  if (!criterion) return null;
  const outcome = evaluateCriterion(criterion, observed);
  return { outcome, brier: brierScore(probability, outcome) };
}

// Human resolution, for the criteria no parser will ever handle.
export function resolveFromOutcome(probability: number, outcome: boolean): Resolution {
  return { outcome, brier: brierScore(probability, outcome) };
}

// Provider-qualified identity is committed with the call. A ticker alone cannot
// distinguish Apple shares from an aapl coin, nor dollars from pounds.
export type ResolutionTarget = {
  assetId: string;
  symbol: string;
  assetClass: AssetClass;
  venue: string;
  currency: string;
  observationPolicy?: "exact" | "last_completed_minute";
  maxAgeMs?: number;
  priceBasis?: "provider_close";
  sessions?: "all";
};

export type ResolutionEvidence = ResolutionTarget & {
  observedAt: number;
  source: string;
  retrievedAt?: number;
  parsedResponseSha256?: string;
};

// Exact time is the default. The optional minute-close contract preregisters
// a bounded age, provider-close basis and all-session scope. Choosing a wider
// window after seeing the outcome is prohibited. Unknown data stays pending.
export function validateEvidence(
  target: ResolutionTarget | undefined,
  evidence: ResolutionEvidence | undefined,
  due: number,
  now: number,
): void {
  if (now < due) throw new Error("forecast horizon has not passed");
  if (!target || !evidence) throw new Error("observedValue requires a precommitted resolutionTarget and evidence");
  for (const key of [
    "assetId",
    "symbol",
    "assetClass",
    "venue",
    "currency",
    "observationPolicy",
    "maxAgeMs",
    "priceBasis",
    "sessions",
  ] as const) {
    if (target[key] !== evidence[key]) throw new Error(`evidence ${key} does not match resolutionTarget`);
  }
  if (!Number.isFinite(evidence.observedAt)) throw new Error("evidence observedAt must be finite");
  if (target.observationPolicy === "last_completed_minute") {
    if (
      !target.maxAgeMs ||
      evidence.observedAt % MINUTE_MS !== 0 ||
      evidence.observedAt > due ||
      due - evidence.observedAt > target.maxAgeMs
    ) {
      throw new Error("evidence is outside the precommitted minute-close window");
    }
  } else if (evidence.observedAt !== due) {
    throw new Error("evidence observedAt must equal the precommitted dueAt");
  }
  if (!evidence.source.trim()) throw new Error("evidence source is required");
}
