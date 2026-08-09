// The rules a forecast lives by, kept out of Convex so they can be tested
// without a backend and reused by the workers and the MCP server.

import { brierScore, isProbability } from "./brier.ts";
import { evaluateCriterion, parseCriterion } from "./criterion.ts";

const MS_PER_SEC = 1000;
// An hour is the shortest horizon worth registering: below that the resolver
// cron cannot even observe the window, and the call is a reflex rather than a
// forecast. Five years is the far end, past which nobody is holding anyone to
// anything.
export const MIN_HORIZON_SEC = 3600;
export const MAX_HORIZON_SEC = 5 * 365 * 24 * 3600;

export type ForecastDraft = {
  subject: string;
  probability: number;
  horizonSec: number;
  resolutionCriterion: string;
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
  const criterion = parseCriterion(resolutionCriterion);
  if (!criterion) return null;
  const outcome = evaluateCriterion(criterion, observed);
  return { outcome, brier: brierScore(probability, outcome) };
}

// Human resolution, for the criteria no parser will ever handle.
export function resolveFromOutcome(probability: number, outcome: boolean): Resolution {
  return { outcome, brier: brierScore(probability, outcome) };
}
