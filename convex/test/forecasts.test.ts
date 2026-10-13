import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { type Harness, type SeededTenant, seedTenant, withConvex } from "./harness.setup";

const DAY_SEC = 86_400;
const START = Date.UTC(2026, 0, 1);
const DUE = START + DAY_SEC * 1000;
const TARGET = {
  assetId: "coingecko:bitcoin",
  symbol: "BTCUSDT",
  assetClass: "crypto" as const,
  venue: "coingecko",
  currency: "USD",
};
const EVIDENCE = { ...TARGET, observedAt: DUE, source: "fixture://bitcoin/2026-01-02T00:00:00Z" };
let now = START;
beforeEach(() => {
  now = START;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

async function emit(t: Harness, tenant: SeededTenant, over: Record<string, unknown> = {}) {
  return t.mutation(api.forecasts.emit, {
    serviceKey: tenant.serviceKey,
    subject: "BTC holds six figures",
    probability: 0.8,
    horizonSec: DAY_SEC,
    resolutionCriterion: "BTCUSDT > 100000",
    ...over,
  });
}
async function setup(over: Record<string, unknown> = {}) {
  const t = withConvex();
  const tenant = await seedTenant(t, "alpha");
  const call = await emit(t, tenant, over);
  return { t, tenant, call };
}

// Same ticker/price values that previously produced a fabricated result.
async function seedPrice(t: Harness, tenant: SeededTenant, asOf: number) {
  await t.mutation(api.accounts.link, {
    serviceKey: tenant.serviceKey,
    accountKey: "exchange",
    venue: "coingecko",
    kind: "exchange",
    label: "fixture",
    currency: "USD",
  });
  await t.mutation(api.balances.syncAccount, {
    serviceKey: tenant.serviceKey,
    accountKey: "exchange",
    asOf,
    rows: [
      {
        symbol: "BTCUSDT",
        assetClass: "crypto",
        qty: 1,
        lastPrice: 104000,
        valueLocal: 104000,
        valueBase: 104000,
        currency: "USD",
      },
    ],
  });
}

describe("registration", () => {
  it("freezes target identity, comparator and horizon before observing outcomes", async () => {
    const { t, tenant, call } = await setup({ resolutionTarget: TARGET, baselineProbability: 0.6 });
    expect(call.dueAt).toBe(DUE);
    const row = (await t.query(api.forecasts.list, { serviceKey: tenant.serviceKey }))[0];
    expect(row.resolutionTarget).toEqual(TARGET);
    expect(row.baselineProbability).toBe(0.6);
    expect(row.authorType).toBe("agent");
  });
  it.each([
    { probability: 1.1 },
    { horizonSec: 5 },
    { horizonSec: NaN },
    { baselineProbability: -0.1 },
    { resolutionTarget: { ...TARGET, symbol: "AAPL" } },
  ])("rejects invalid registration %j", async (over) => {
    await expect(setup(over)).rejects.toThrow();
  });
});

describe("evidence settlement", () => {
  it("stores matched historical identity, timestamp, value, source and audit", async () => {
    const { t, tenant, call } = await setup({ resolutionTarget: TARGET });
    now = DUE + 30 * DAY_SEC * 1000;
    expect(
      await t.mutation(api.forecasts.settle, {
        serviceKey: tenant.serviceKey,
        forecastId: call.id,
        observedValue: 104000,
        evidence: EVIDENCE,
      }),
    ).toEqual({ outcome: true, brier: expect.closeTo(0.04, 10) });
    const row = (await t.query(api.forecasts.list, { serviceKey: tenant.serviceKey }))[0];
    expect(row.resolutionEvidence).toEqual(EVIDENCE);
    expect(row.resolutionMethod).toBe("evidence");
    const audit = await t.query(api.audit.list, { serviceKey: tenant.serviceKey, kind: "forecast.resolved" });
    expect(audit[0].detail).toContain(EVIDENCE.source);
    expect(audit[0].detail).toContain(String(DUE));
    await expect(
      t.mutation(api.forecasts.settle, {
        serviceKey: tenant.serviceKey,
        forecastId: call.id,
        observedValue: 1,
        evidence: EVIDENCE,
      }),
    ).rejects.toThrow(/already resolved/);
  });
  it.each([
    { assetId: "coingecko:aapl" },
    { venue: "yahoo" },
    { currency: "GBP" },
    { assetClass: "equity" as const },
    { symbol: "AAPL" },
    { observedAt: DUE - 1 },
    { observedAt: DUE + 1 },
    { source: " " },
  ])("refuses mismatched or untraceable evidence %j", async (over) => {
    const { t, tenant, call } = await setup({ resolutionTarget: TARGET });
    now = DUE;
    await expect(
      t.mutation(api.forecasts.settle, {
        serviceKey: tenant.serviceKey,
        forecastId: call.id,
        observedValue: 104000,
        evidence: { ...EVIDENCE, ...over },
      }),
    ).rejects.toThrow();
    expect((await t.query(api.forecasts.list, { serviceKey: tenant.serviceKey }))[0].status).toBe("open");
  });
  it("rejects early settlements and manual bypasses of committed evidence", async () => {
    const { t, tenant, call } = await setup({ resolutionTarget: TARGET });
    await expect(
      t.mutation(api.forecasts.settle, {
        serviceKey: tenant.serviceKey,
        forecastId: call.id,
        observedValue: 104000,
        evidence: EVIDENCE,
      }),
    ).rejects.toThrow(/horizon/);
    now = DUE;
    await expect(
      t.mutation(api.forecasts.settle, {
        serviceKey: tenant.serviceKey,
        forecastId: call.id,
        outcome: true,
        note: "override",
      }),
    ).rejects.toThrow(/historical evidence/);
  });
  it("cannot attach an arbitrary observation to a legacy ticker-only call", async () => {
    const { t, tenant, call } = await setup();
    now = DUE;
    await expect(
      t.mutation(api.forecasts.settle, {
        serviceKey: tenant.serviceKey,
        forecastId: call.id,
        observedValue: 104000,
        evidence: EVIDENCE,
      }),
    ).rejects.toThrow(/precommitted/);
  });
  it("requires a source note for manual outcomes and rejects contradictory input", async () => {
    const { t, tenant, call } = await setup({ resolutionCriterion: "the Fed cuts" });
    now = DUE;
    await expect(
      t.mutation(api.forecasts.settle, { serviceKey: tenant.serviceKey, forecastId: call.id, outcome: false }),
    ).rejects.toThrow(/note/);
    await expect(
      t.mutation(api.forecasts.settle, {
        serviceKey: tenant.serviceKey,
        forecastId: call.id,
        outcome: false,
        observedValue: 1,
        note: "fixture",
      }),
    ).rejects.toThrow(/never both/);
    expect(
      await t.mutation(api.forecasts.settle, {
        serviceKey: tenant.serviceKey,
        forecastId: call.id,
        outcome: false,
        note: "fixture://central-bank/decision",
      }),
    ).toMatchObject({ brier: expect.closeTo(0.64, 10) });
  });
  it("enforces the tenant gate even with matching evidence", async () => {
    const { t, tenant, call } = await setup({ resolutionTarget: TARGET });
    const beta = await seedTenant(t, "beta");
    now = DUE;
    await expect(
      t.mutation(api.forecasts.settle, {
        serviceKey: beta.serviceKey,
        forecastId: call.id,
        observedValue: 104000,
        evidence: EVIDENCE,
      }),
    ).rejects.toThrow(/not found/);
    expect((await t.query(api.forecasts.list, { serviceKey: tenant.serviceKey }))[0].status).toBe("open");
  });
});

describe("fail-closed automatic resolution", () => {
  it.each([START, DUE, DUE + DAY_SEC * 1000])(
    "never treats balance timestamp %d as settlement evidence",
    async (asOf) => {
      const { t, tenant, call } = await setup({ resolutionTarget: TARGET });
      await seedPrice(t, tenant, asOf);
      now = DUE + DAY_SEC * 1000;
      expect(await t.mutation(internal.forecasts.resolveDue, {})).toMatchObject({
        seen: 1,
        resolved: 0,
        unobserved: 1,
      });
      expect((await t.query(api.forecasts.list, { serviceKey: tenant.serviceKey }))[0].status).toBe("open");
      expect((await t.query(api.forecasts.listDue, { serviceKey: tenant.serviceKey }))[0]).toMatchObject({
        id: call.id,
        dueAt: DUE,
        resolutionTarget: TARGET,
        requiresHistoricalEvidence: true,
      });
    },
  );
  it("keeps prose pending and ignores forecasts before the horizon", async () => {
    const { t } = await setup({ resolutionCriterion: "the Fed cuts" });
    expect(await t.mutation(internal.forecasts.resolveDue, {})).toMatchObject({ seen: 0 });
    now = DUE;
    expect(await t.mutation(internal.forecasts.resolveDue, {})).toMatchObject({ human: 1, resolved: 0 });
  });
});

describe("honest cohort scoring", () => {
  it("reports paired baselines, pending/void/legacy counts without implied significance", async () => {
    const { t, tenant, call } = await setup({ baselineProbability: 0.95 });
    const miss = await emit(t, tenant, { probability: 0.9, baselineProbability: 0.95 });
    await emit(t, tenant);
    const voided = await emit(t, tenant);
    const legacy = await emit(t, tenant);
    await t.run(async (ctx) => {
      await ctx.db.patch(legacy.id, { status: "resolved", outcome: true, brier: 0.04 });
    });
    await t.mutation(api.forecasts.voidForecast, {
      serviceKey: tenant.serviceKey,
      forecastId: voided.id,
      reason: "fixture event cancelled",
    });
    now = DUE;
    await t.mutation(api.forecasts.settle, {
      serviceKey: tenant.serviceKey,
      forecastId: call.id,
      outcome: true,
      note: "fixture://outcome/1",
    });
    await t.mutation(api.forecasts.settle, {
      serviceKey: tenant.serviceKey,
      forecastId: miss.id,
      outcome: false,
      note: "fixture://outcome/2",
    });
    const record = await t.query(api.forecasts.calibration, { serviceKey: tenant.serviceKey });
    expect(record).toMatchObject({
      n: 2,
      open: 1,
      voided: 1,
      legacyResolved: 1,
      confidenceInterval: null,
      observedBaseRate: 0.5,
    });
    expect(record.meanBrier).toBeCloseTo(0.425);
    expect(record.paired).toMatchObject({
      n: 2,
      meanBrier: expect.closeTo(0.425),
      baselineMeanBrier: expect.closeTo(0.4525),
      meanDifference: expect.closeTo(-0.0275),
    });
    const beta = await seedTenant(t, "beta");
    expect((await t.query(api.forecasts.calibration, { serviceKey: beta.serviceKey })).n).toBe(0);
  });
  it("does not manufacture a baseline or a zero score for an empty sample", async () => {
    const { t, tenant } = await setup();
    const record = await t.query(api.forecasts.calibration, { serviceKey: tenant.serviceKey });
    expect(record).toMatchObject({ n: 0, meanBrier: null, paired: { n: 0, meanDifference: null } });
  });
  it("rejects blank void reasons and invalid aggregation parameters", async () => {
    const { t, tenant, call } = await setup();
    await expect(
      t.mutation(api.forecasts.voidForecast, { serviceKey: tenant.serviceKey, forecastId: call.id, reason: " " }),
    ).rejects.toThrow(/reason/);
    await expect(t.query(api.forecasts.calibration, { serviceKey: tenant.serviceKey, buckets: 0 })).rejects.toThrow(
      /bucketCount/,
    );
    await expect(t.query(api.forecasts.calibration, { serviceKey: tenant.serviceKey, windowDays: -1 })).rejects.toThrow(
      /windowDays/,
    );
  });
});

describe("precommitted historical minute close", () => {
  const minuteTarget = {
    assetId: "yahoo:AAPL",
    symbol: "AAPL",
    assetClass: "equity" as const,
    venue: "yahoo",
    currency: "USD",
    observationPolicy: "last_completed_minute" as const,
    priceBasis: "provider_close" as const,
    sessions: "all" as const,
    maxAgeMs: 120000,
  };
  it("scores an admissible historical bar after the horizon and audits the policy", async () => {
    const { t, tenant, call } = await setup({ resolutionCriterion: "AAPL > 100", resolutionTarget: minuteTarget });
    now = DUE + 3600000;
    const evidence = { ...minuteTarget, observedAt: DUE - 60000, source: "fixture://yahoo/AAPL?interval=1m" };
    await t.mutation(api.forecasts.settle, {
      serviceKey: tenant.serviceKey,
      forecastId: call.id,
      observedValue: 101,
      evidence,
    });
    expect((await t.query(api.forecasts.list, { serviceKey: tenant.serviceKey }))[0]).toMatchObject({
      outcome: true,
      resolutionEvidence: evidence,
    });
  });
  it.each([{ observedAt: DUE + 60000 }, { observedAt: DUE - 180000 }, { maxAgeMs: 345600000 }])(
    "rejects hindsight widening or wrong-time observations %j",
    async (over) => {
      const { t, tenant, call } = await setup({ resolutionCriterion: "AAPL > 100", resolutionTarget: minuteTarget });
      now = DUE;
      const evidence = { ...minuteTarget, observedAt: DUE, source: "fixture://yahoo/AAPL", ...over };
      await expect(
        t.mutation(api.forecasts.settle, {
          serviceKey: tenant.serviceKey,
          forecastId: call.id,
          observedValue: 101,
          evidence,
        }),
      ).rejects.toThrow();
    },
  );
});
