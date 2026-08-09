import { describe, expect, it } from "vitest";
import { groupBy, highestBy, lowestBy } from "../src/order.ts";

type Row = { symbol: string; asOf: number };

const rows: Row[] = [
  { symbol: "BTCUSDT", asOf: 300 },
  { symbol: "ETHUSDT", asOf: 100 },
  { symbol: "BTCUSDT", asOf: 500 },
];

describe("picking a row out of index order", () => {
  // The bug this pins: reading rows[0] to get "the current price" returns
  // whichever sync inserted first, not the freshest observation.
  it("finds the freshest row rather than the first one", () => {
    expect(highestBy(rows, (r) => r.asOf)?.asOf).toBe(500);
    expect(lowestBy(rows, (r) => r.asOf)?.asOf).toBe(100);
  });

  it("reports nothing for an empty set instead of throwing", () => {
    expect(highestBy([], (r: Row) => r.asOf)).toBeUndefined();
  });
});

describe("grouping", () => {
  it("keeps first-seen key order so a rendered table is stable", () => {
    const grouped = groupBy(rows, (r) => r.symbol);
    expect([...grouped.keys()]).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(grouped.get("BTCUSDT")).toHaveLength(2);
  });
});
