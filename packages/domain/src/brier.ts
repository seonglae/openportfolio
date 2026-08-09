// Brier scoring and the reliability diagram behind it.
//
// The Brier score is the squared error of a probability against what happened:
// (p - outcome)^2, lower is better. Always predicting the base rate of a coin
// flip scores 0.25, which is the line a track record has to beat before any of
// it counts as skill.

export const BRIER_RANDOM_BASELINE = 0.25;
const DEFAULT_BUCKET_COUNT = 10;

export function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

// Throws rather than clamping. A probability outside [0, 1] is a bug in
// whatever produced it, and clamping would score the bug as if it were a call.
export function brierScore(probability: number, outcome: boolean): number {
  if (!isProbability(probability)) throw new Error(`probability out of range: ${probability}`);
  const actual = outcome ? 1 : 0;
  return (probability - actual) ** 2;
}

export function meanBrier(scores: readonly number[]): number | null {
  if (scores.length === 0) return null;
  let total = 0;
  for (const score of scores) total += score;
  return total / scores.length;
}

export type CalibrationPoint = { probability: number; outcome: boolean };

export type ReliabilityBucket = {
  lower: number;
  upper: number;
  count: number;
  // Mean of the probabilities said in this bucket, and the rate at which they
  // came true. A calibrated forecaster has the two roughly equal.
  meanProbability: number;
  observedRate: number;
};

// Empty buckets are kept in the output. A reliability diagram with the empty
// bins dropped looks better than the record is: the gaps are where the
// forecaster never committed, and that is worth seeing.
export function reliabilityBuckets(
  points: readonly CalibrationPoint[],
  bucketCount: number = DEFAULT_BUCKET_COUNT,
): ReliabilityBucket[] {
  const width = 1 / bucketCount;
  const sums = new Array<number>(bucketCount).fill(0);
  const hits = new Array<number>(bucketCount).fill(0);
  const counts = new Array<number>(bucketCount).fill(0);

  for (const point of points) {
    if (!isProbability(point.probability)) continue;
    // Multiply, do not divide by the width: 0.7 / 0.1 is 6.999999999999999 in
    // binary floating point, which files a 70% call under the 60s and makes the
    // diagram lie about the bucket the forecaster actually used. 0.7 * 10 is
    // exact enough to floor correctly.
    //
    // p === 1 would land one past the last bucket, so it is folded back in.
    const raw = Math.floor(point.probability * bucketCount);
    const index = Math.min(raw, bucketCount - 1);
    counts[index] += 1;
    sums[index] += point.probability;
    if (point.outcome) hits[index] += 1;
  }

  const out: ReliabilityBucket[] = [];
  for (const [index, count] of counts.entries()) {
    let meanProbability = 0;
    let observedRate = 0;
    if (count > 0) {
      meanProbability = sums[index] / count;
      observedRate = hits[index] / count;
    }
    out.push({ lower: index * width, upper: (index + 1) * width, count, meanProbability, observedRate });
  }
  return out;
}

// Expected calibration error: the count-weighted average gap between what was
// said and what happened. Null when there is nothing scored yet, because zero
// would read as perfect calibration.
export function expectedCalibrationError(buckets: readonly ReliabilityBucket[]): number | null {
  let total = 0;
  let weighted = 0;
  for (const bucket of buckets) {
    total += bucket.count;
    weighted += bucket.count * Math.abs(bucket.meanProbability - bucket.observedRate);
  }
  if (total === 0) return null;
  return weighted / total;
}
