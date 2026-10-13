import { describe, expect, it } from "vitest";
import { brierScore, meanBrier } from "@openportfolio/domain";
import { FIXTURES } from "../demo/fixtures.ts";

describe("synthetic demo integrity", () => {
  it("derives reported scores and counts from the displayed outcomes", () => {
    const rows = FIXTURES["forecasts:list"] as Array<{ probability: number; outcome?: boolean; brier: number | null }>;
    const record = FIXTURES["forecasts:calibration"] as {
      n: number;
      meanBrier: number;
      buckets: Array<{ count: number }>;
    };
    const scored = rows.filter((row) => row.outcome !== undefined);
    expect(record.n).toBe(scored.length);
    expect(record.buckets.reduce((total, b) => total + b.count, 0)).toBe(scored.length);
    expect(record.meanBrier).toBe(meanBrier(scored.map((row) => brierScore(row.probability, row.outcome === true))));
    for (const row of scored) expect(row.brier).toBe(brierScore(row.probability, row.outcome === true));
  });
});
