// Test-only imports: node adapters are never imported by deployed handlers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { seedTenant, withConvex } from "./harness.setup";
import { createYahooAdapter } from "../../packages/node/src/adapters/yahoo.ts";
import { createAdapterRegistry } from "../../packages/node/src/adapters/registry.ts";
import { drainHistoricalForecasts } from "../../packages/node/src/settlement.ts";

const START = Date.UTC(2026, 0, 1, 14);
const DUE = START + 3600000;
afterEach(() => vi.restoreAllMocks());
describe("worker to historical provider fixture to real backend", () => {
  it("settles the registered call at its historical close and retains auditable evidence", async () => {
    let now = START;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const t = withConvex();
    const tenant = await seedTenant(t, "fixture");
    const target = {
      assetId: "yahoo:AAPL",
      symbol: "AAPL",
      assetClass: "equity" as const,
      venue: "yahoo",
      currency: "USD",
      observationPolicy: "last_completed_minute" as const,
      priceBasis: "provider_close" as const,
      sessions: "all" as const,
      maxAgeMs: 60000,
    };
    for (const i of Array.from({ length: 101 }, (_, index) => index)) {
      await t.mutation(api.forecasts.emit, {
        serviceKey: tenant.serviceKey,
        subject: `unsupported ${i}`,
        probability: 0.5,
        horizonSec: 3600,
        resolutionCriterion: "legacy prose fixture",
      });
    }
    const emitted = await t.mutation(api.forecasts.emit, {
      serviceKey: tenant.serviceKey,
      subject: "Apple close",
      probability: 0.8,
      horizonSec: 3600,
      resolutionCriterion: "AAPL > 100",
      resolutionTarget: target,
      baselineProbability: 0.6,
    });
    now = DUE + 86400000;
    const pages: number[] = [];
    const provider = createYahooAdapter({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: {
                    symbol: "AAPL",
                    instrumentType: "EQUITY",
                    currency: "USD",
                    dataGranularity: "1m",
                    regularMarketPrice: 1,
                  },
                  timestamp: [(DUE - 60000) / 1000, DUE / 1000],
                  indicators: { quote: [{ close: [101, 1] }] },
                },
              ],
            },
          }),
        ),
    });
    const pending = vi.fn();
    const results = await drainHistoricalForecasts(
      createAdapterRegistry([provider]),
      async (cursor, cutoff) => {
        const page = await t.query(api.forecasts.listDuePage, {
          serviceKey: tenant.serviceKey,
          now: cutoff,
          paginationOpts: { cursor, numItems: 100 },
        });
        pages.push(page.page.length);
        return page;
      },
      (args) => t.mutation(api.forecasts.settle, { ...args, forecastId: emitted.id, serviceKey: tenant.serviceKey }),
      pending,
      now,
    );
    expect(pending).toHaveBeenCalledTimes(101);
    expect(pages).toEqual([100, 2]);
    expect(results[0].brier).toBeCloseTo(0.04);
    const record = await t.query(api.forecasts.calibration, { serviceKey: tenant.serviceKey });
    expect(record.paired).toMatchObject({ n: 1, meanDifference: expect.closeTo(-0.12) });
    const row = (await t.query(api.forecasts.list, { serviceKey: tenant.serviceKey, limit: 500 })).find(
      (row) => row._id === emitted.id,
    );
    expect(row).toMatchObject({
      outcome: true,
      observedValue: 101,
      resolutionEvidence: { observedAt: DUE, ...target },
    });
    expect(row?.resolutionEvidence?.source).toContain("finance.yahoo.com");
    expect(await t.query(api.forecasts.listDue, { serviceKey: tenant.serviceKey, limit: 500 })).toHaveLength(101);
    expect(await t.query(api.audit.list, { serviceKey: tenant.serviceKey, kind: "forecast.resolved" })).toHaveLength(1);
  });
});
