import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type Harness, type SeededTenant, seedTenant, withConvex } from "./harness.setup";

const DAY_SEC = 86_400;
const HOUR_MS = 3_600_000;

async function emit(t: Harness, tenant: SeededTenant, over: Record<string, unknown> = {}) {
  return await t.mutation(api.forecasts.emit, {
    serviceKey: tenant.serviceKey,
    subject: "BTC holds six figures",
    probability: 0.8,
    horizonSec: DAY_SEC,
    resolutionCriterion: "BTCUSDT > 100000",
    ...over,
  });
}

// A price the resolver can observe has to arrive the way the sync worker
// delivers it: on a balance row, attached to an account.
async function seedPrice(t: Harness, tenant: SeededTenant, symbol: string, lastPrice: number, asOf: number) {
  await t.mutation(api.accounts.link, {
    serviceKey: tenant.serviceKey,
    accountKey: `${tenant.slug}-exchange`,
    venue: "coingecko",
    kind: "exchange",
    label: "exchange",
    currency: "USD",
  });
  await t.mutation(api.balances.syncAccount, {
    serviceKey: tenant.serviceKey,
    accountKey: `${tenant.slug}-exchange`,
    asOf,
    rows: [
      {
        symbol,
        assetClass: "crypto",
        qty: 1,
        lastPrice,
        valueLocal: lastPrice,
        valueBase: lastPrice,
        currency: "USD",
      },
    ],
  });
}

describe("registering a call", () => {
  it("fixes the horizon at emit time", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const before = Date.now();
    const { dueAt } = await emit(t, alpha);
    expect(dueAt).toBeGreaterThanOrEqual(before + DAY_SEC * 1000);
  });

  it("refuses a probability outside [0, 1] and a horizon nobody can observe", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await expect(emit(t, alpha, { probability: 1.5 })).rejects.toThrow(/probability out of range/);
    await expect(emit(t, alpha, { horizonSec: 5 })).rejects.toThrow(/horizonSec below/);
  });

  it("records a service-key caller as an agent, not a person", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await emit(t, alpha);
    const rows = await t.query(api.forecasts.list, { serviceKey: alpha.serviceKey });
    expect(rows[0].authorType).toBe("agent");
    expect(rows[0].author).toBe("service:serviceKey");
  });
});

describe("settling a call", () => {
  it("scores the squared error against the observation", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const { id } = await emit(t, alpha);
    const result = await t.mutation(api.forecasts.settle, {
      serviceKey: alpha.serviceKey,
      forecastId: id,
      observedValue: 104_000,
    });
    expect(result.outcome).toBe(true);
    expect(result.brier).toBeCloseTo(0.04, 10);
  });

  it("will not settle the same call twice", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const { id } = await emit(t, alpha);
    await t.mutation(api.forecasts.settle, { serviceKey: alpha.serviceKey, forecastId: id, observedValue: 104_000 });
    await expect(
      t.mutation(api.forecasts.settle, { serviceKey: alpha.serviceKey, forecastId: id, observedValue: 1 }),
    ).rejects.toThrow(/already resolved/);
  });

  // Prose is a legitimate criterion. What it is not is machine-resolvable, and
  // guessing at it would score the forecaster on the parser's opinion.
  it("demands an explicit outcome for a criterion no parser can read", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const { id } = await emit(t, alpha, { resolutionCriterion: "the Fed cuts before September" });
    await expect(
      t.mutation(api.forecasts.settle, { serviceKey: alpha.serviceKey, forecastId: id, observedValue: 1 }),
    ).rejects.toThrow(/pass an outcome/);
    const settled = await t.mutation(api.forecasts.settle, {
      serviceKey: alpha.serviceKey,
      forecastId: id,
      outcome: false,
    });
    expect(settled.brier).toBeCloseTo(0.64, 10);
  });

  it("drops a voided call from the record instead of scoring it as a miss", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const { id } = await emit(t, alpha);
    await t.mutation(api.forecasts.voidForecast, {
      serviceKey: alpha.serviceKey,
      forecastId: id,
      reason: "ticker delisted",
    });
    const record = await t.query(api.forecasts.calibration, { serviceKey: alpha.serviceKey });
    expect(record.n).toBe(0);
  });
});

describe("the resolver cron", () => {
  it("settles a due call from the freshest observed price", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const { id } = await emit(t, alpha);
    // Two rows for the same symbol, written out of order. Reading the first one
    // off the index would resolve against the stale price.
    await seedPrice(t, alpha, "BTCUSDT", 90_000, Date.now() - HOUR_MS);
    await seedPrice(t, alpha, "BTCUSDT", 104_000, Date.now());

    const summary = await t.mutation(internal.forecasts.resolveDue, { now: Date.now() + DAY_SEC * 1000 });
    expect(summary.resolved).toBe(1);

    const row = await t.run(async (ctx) => ctx.db.get(id as Id<"forecasts">));
    expect(row?.status).toBe("resolved");
    expect(row?.observedValue).toBe(104_000);
    expect(row?.brier).toBeCloseTo(0.04, 10);
  });

  it("leaves a call open when nothing observed its symbol", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await emit(t, alpha);
    const summary = await t.mutation(internal.forecasts.resolveDue, { now: Date.now() + DAY_SEC * 1000 });
    expect(summary).toMatchObject({ resolved: 0, unobserved: 1 });
    const rows = await t.query(api.forecasts.list, { serviceKey: alpha.serviceKey });
    expect(rows[0].status).toBe("open");
  });

  it("leaves prose to a human and says how many are waiting", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await emit(t, alpha, { resolutionCriterion: "the Fed cuts before September" });
    const summary = await t.mutation(internal.forecasts.resolveDue, { now: Date.now() + DAY_SEC * 1000 });
    expect(summary).toMatchObject({ resolved: 0, human: 1 });
  });

  it("does not touch a call whose horizon has not passed", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await emit(t, alpha);
    await seedPrice(t, alpha, "BTCUSDT", 104_000, Date.now());
    expect(await t.mutation(internal.forecasts.resolveDue, {})).toMatchObject({ seen: 0 });
  });

  // The cron is the one function in the backend that crosses tenants. It has to
  // resolve each book against that book's own observations.
  it("resolves every tenant against its own prices", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const beta = await seedTenant(t, "beta");
    await emit(t, alpha);
    await emit(t, beta);
    await seedPrice(t, alpha, "BTCUSDT", 104_000, Date.now());
    await seedPrice(t, beta, "BTCUSDT", 96_000, Date.now());

    await t.mutation(internal.forecasts.resolveDue, { now: Date.now() + DAY_SEC * 1000 });

    const alphaRow = (await t.query(api.forecasts.list, { serviceKey: alpha.serviceKey }))[0];
    const betaRow = (await t.query(api.forecasts.list, { serviceKey: beta.serviceKey }))[0];
    expect(alphaRow.outcome).toBe(true);
    expect(betaRow.outcome).toBe(false);
  });

  it("writes the cron itself into the audit log rather than a borrowed actor", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await emit(t, alpha);
    await seedPrice(t, alpha, "BTCUSDT", 104_000, Date.now());
    await t.mutation(internal.forecasts.resolveDue, { now: Date.now() + DAY_SEC * 1000 });
    const entries = await t.query(api.audit.list, { serviceKey: alpha.serviceKey, kind: "forecast.resolved" });
    expect(entries[0].actor).toBe("cron:resolver");
  });
});

describe("the due queue the worker reads", () => {
  it("names the symbol each due call needs, and nothing for prose", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await emit(t, alpha);
    await emit(t, alpha, { resolutionCriterion: "the Fed cuts before September" });
    const due = await t.query(api.forecasts.listDue, {
      serviceKey: alpha.serviceKey,
      now: Date.now() + DAY_SEC * 1000,
    });
    expect(due.map((row) => row.symbol).sort()).toEqual(["BTCUSDT", null]);
  });
});

describe("the track record", () => {
  it("counts scored calls only, and reports the line skill has to beat", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const hit = await emit(t, alpha, { probability: 0.9 });
    const miss = await emit(t, alpha, { probability: 0.9 });
    await emit(t, alpha);
    await t.mutation(api.forecasts.settle, { serviceKey: alpha.serviceKey, forecastId: hit.id, outcome: true });
    await t.mutation(api.forecasts.settle, { serviceKey: alpha.serviceKey, forecastId: miss.id, outcome: false });

    const record = await t.query(api.forecasts.calibration, { serviceKey: alpha.serviceKey, buckets: 10 });
    expect(record.n).toBe(2);
    expect(record.meanBrier).toBeCloseTo(0.41, 10);
    expect(record.randomBaseline).toBe(0.25);
    expect(record.buckets).toHaveLength(10);
    // Said 90%, right half the time: the gap the diagram exists to show.
    expect(record.buckets[9].meanProbability).toBeCloseTo(0.9, 10);
    expect(record.buckets[9].observedRate).toBe(0.5);
    expect(record.expectedCalibrationError).toBeCloseTo(0.4, 10);
  });

  it("scores each tenant's record separately", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const beta = await seedTenant(t, "beta");
    const a = await emit(t, alpha);
    await t.mutation(api.forecasts.settle, { serviceKey: alpha.serviceKey, forecastId: a.id, outcome: true });
    expect((await t.query(api.forecasts.calibration, { serviceKey: beta.serviceKey })).n).toBe(0);
  });
});
