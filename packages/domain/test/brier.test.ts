import { describe, expect, it } from "vitest";
import {
  BRIER_RANDOM_BASELINE,
  brierScore,
  expectedCalibrationError,
  meanBrier,
  reliabilityBuckets,
} from "../src/brier.ts";

describe("scoring one call", () => {
  it("scores a confident hit near zero and a confident miss near one", () => {
    expect(brierScore(0.9, true)).toBeCloseTo(0.01, 10);
    expect(brierScore(0.9, false)).toBeCloseTo(0.81, 10);
  });

  it("scores a coin flip at the random baseline whichever way it lands", () => {
    expect(brierScore(0.5, true)).toBe(BRIER_RANDOM_BASELINE);
    expect(brierScore(0.5, false)).toBe(BRIER_RANDOM_BASELINE);
  });

  // Clamping would score the bug as if it were a call, and the track record is
  // the entire product.
  it("throws on a probability outside [0, 1] rather than clamping it", () => {
    expect(() => brierScore(1.2, true)).toThrow(/out of range/);
    expect(() => brierScore(-0.1, true)).toThrow(/out of range/);
    expect(() => brierScore(Number.NaN, true)).toThrow(/out of range/);
  });
});

describe("the mean over a record", () => {
  it("reports null for an empty record, because zero would read as perfect", () => {
    expect(meanBrier([])).toBeNull();
  });

  it("averages the scores it is given", () => {
    expect(meanBrier([0, 0.25, 0.5])).toBeCloseTo(0.25, 10);
  });
});

describe("the reliability diagram", () => {
  it("keeps empty buckets, because a gap is where nobody committed", () => {
    const buckets = reliabilityBuckets([{ probability: 0.05, outcome: true }], 10);
    expect(buckets).toHaveLength(10);
    expect(buckets[0].count).toBe(1);
    expect(buckets[9].count).toBe(0);
  });

  // 0.7 / 0.1 is 6.999999999999999, which would file a 70% call under the 60s.
  it("puts a probability in the bucket a human would put it in", () => {
    const decile = (p: number) =>
      reliabilityBuckets([{ probability: p, outcome: true }], 10).findIndex((b) => b.count === 1);
    expect(decile(0.3)).toBe(3);
    expect(decile(0.6)).toBe(6);
    expect(decile(0.7)).toBe(7);
    expect(decile(0.29)).toBe(2);
  });

  // p === 1 times the bucket count lands one past the last bucket.
  it("folds a probability of exactly 1 into the last bucket", () => {
    const buckets = reliabilityBuckets([{ probability: 1, outcome: true }], 10);
    expect(buckets[9].count).toBe(1);
    expect(buckets[9].observedRate).toBe(1);
  });

  it("puts said and observed side by side for a calibrated forecaster", () => {
    const points = [
      { probability: 0.8, outcome: true },
      { probability: 0.8, outcome: true },
      { probability: 0.8, outcome: true },
      { probability: 0.8, outcome: false },
    ];
    const buckets = reliabilityBuckets(points, 10);
    const bucket = buckets[8];
    expect(bucket.count).toBe(4);
    expect(bucket.meanProbability).toBeCloseTo(0.8, 10);
    expect(bucket.observedRate).toBeCloseTo(0.75, 10);
  });

  it("weights the calibration error by how often each bucket was used", () => {
    const overconfident = [
      { probability: 0.9, outcome: true },
      { probability: 0.9, outcome: false },
    ];
    const error = expectedCalibrationError(reliabilityBuckets(overconfident, 10));
    expect(error).toBeCloseTo(0.4, 10);
  });

  it("reports null calibration error with nothing scored", () => {
    expect(expectedCalibrationError(reliabilityBuckets([], 10))).toBeNull();
  });
});

// The base rate can be easier than the constant-50% reference. These identical
// events are a numerical illustration, not a claim of independent evidence.
describe("paired preregistered baselines", () => {
  it("exposes a forecast below 0.25 that still loses to its base-rate comparator", async () => {
    const { pairedBrierComparison } = await import("../src/brier.ts");
    const points = Array.from({ length: 10 }, (_, i) => ({
      probability: 0.8,
      baselineProbability: 0.9,
      outcome: i < 9,
    }));
    expect(pairedBrierComparison(points)).toMatchObject({
      n: 10,
      meanBrier: expect.closeTo(0.1),
      baselineMeanBrier: expect.closeTo(0.09),
      meanDifference: expect.closeTo(0.01),
    });
  });
  it("keeps empty comparisons null and rejects an invalid baseline", async () => {
    const { pairedBrierComparison } = await import("../src/brier.ts");
    expect(pairedBrierComparison([])).toEqual({ n: 0, meanBrier: null, baselineMeanBrier: null, meanDifference: null });
    expect(() => pairedBrierComparison([{ probability: 0.5, outcome: true, baselineProbability: 1.1 }])).toThrow();
  });
});
