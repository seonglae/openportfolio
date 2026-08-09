import { describe, expect, it } from "vitest";
import {
  MAX_HORIZON_SEC,
  MIN_HORIZON_SEC,
  dueAt,
  isDue,
  resolveFromObservation,
  resolveFromOutcome,
  validateForecast,
} from "../src/forecast.ts";

const HOUR_SEC = 3600;
const CREATED_AT = Date.UTC(2026, 0, 1);

describe("registering a forecast", () => {
  it("accepts a complete draft", () => {
    const problems = validateForecast({
      subject: "BTC holds six figures",
      probability: 0.62,
      horizonSec: 30 * 24 * HOUR_SEC,
      resolutionCriterion: "BTCUSDT > 100000",
    });
    expect(problems).toEqual([]);
  });

  // All of them at once, so filling the form is not a game of whack-a-mole.
  it("reports every problem rather than the first", () => {
    const problems = validateForecast({
      subject: "  ",
      probability: 1.4,
      horizonSec: 1,
      resolutionCriterion: "",
    });
    expect(problems).toHaveLength(4);
  });

  it("refuses a horizon the resolver cron cannot observe", () => {
    expect(
      validateForecast({
        subject: "s",
        probability: 0.5,
        horizonSec: MIN_HORIZON_SEC - 1,
        resolutionCriterion: "X > 1",
      }),
    ).toContain(`horizonSec below ${MIN_HORIZON_SEC}`);
  });

  it("refuses a horizon nobody will be held to", () => {
    expect(
      validateForecast({
        subject: "s",
        probability: 0.5,
        horizonSec: MAX_HORIZON_SEC + 1,
        resolutionCriterion: "X > 1",
      }),
    ).toContain(`horizonSec above ${MAX_HORIZON_SEC}`);
  });
});

describe("the horizon", () => {
  it("turns seconds into the instant the call comes due", () => {
    expect(dueAt(CREATED_AT, HOUR_SEC)).toBe(CREATED_AT + HOUR_SEC * 1000);
  });

  it("is due at the boundary, not one tick after", () => {
    const due = dueAt(CREATED_AT, HOUR_SEC);
    expect(isDue(due, due)).toBe(true);
    expect(isDue(due, due - 1)).toBe(false);
  });
});

describe("resolving", () => {
  it("scores a machine-resolvable criterion against an observation", () => {
    const hit = resolveFromObservation(0.8, "BTCUSDT > 100000", 104000);
    expect(hit).toEqual({ outcome: true, brier: expect.closeTo(0.04, 10) });

    const miss = resolveFromObservation(0.8, "BTCUSDT > 100000", 96000);
    expect(miss?.outcome).toBe(false);
    expect(miss?.brier).toBeCloseTo(0.64, 10);
  });

  // The bug this pins: collapsing "not parseable" into "did not happen" would
  // score every prose forecast as a miss the moment the cron ran.
  it("returns null for prose instead of scoring it as a miss", () => {
    expect(resolveFromObservation(0.8, "the Fed cuts before September", 1)).toBeNull();
  });

  it("scores a human resolution for the criteria no parser will handle", () => {
    expect(resolveFromOutcome(0.3, false)).toEqual({ outcome: false, brier: expect.closeTo(0.09, 10) });
  });
});
