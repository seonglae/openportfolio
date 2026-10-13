// Identical fixture assertions run against base 8b7765f and the PR head.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { seedTenant, withConvex } from "./harness.setup";

const START = Date.UTC(2026, 0, 1);
const DUE = START + 3600000;
let now = START;
beforeEach(() => {
  now = START;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const t = withConvex();
  const tenant = await seedTenant(t, "fixture");
  const { id } = await t.mutation(api.forecasts.emit, {
    serviceKey: tenant.serviceKey,
    subject: "Apple",
    probability: 0.8,
    horizonSec: 3600,
    resolutionCriterion: "AAPL > 100",
  });
  return { t, tenant, id };
}
describe("baseline-comparable settlement regressions", () => {
  it.each([START, DUE + 3600000])("does not settle using balance timestamp %d", async (asOf) => {
    const { t, tenant } = await fixture();
    await t.mutation(api.accounts.link, {
      serviceKey: tenant.serviceKey,
      accountKey: "fixture",
      venue: "yahoo",
      kind: "brokerage",
      label: "fixture",
      currency: "USD",
    });
    await t.mutation(api.balances.syncAccount, {
      serviceKey: tenant.serviceKey,
      accountKey: "fixture",
      asOf,
      rows: [
        {
          symbol: "AAPL",
          assetClass: "equity",
          qty: 1,
          lastPrice: 101,
          valueLocal: 101,
          valueBase: 101,
          currency: "USD",
        },
      ],
    });
    now = DUE + 7200000;
    expect((await t.mutation(internal.forecasts.resolveDue, {})).resolved).toBe(0);
  });
  it("rejects early manual outcomes", async () => {
    const { t, tenant, id } = await fixture();
    await expect(
      t.mutation(api.forecasts.settle, {
        serviceKey: tenant.serviceKey,
        forecastId: id,
        outcome: true,
        note: "fixture://observation",
      }),
    ).rejects.toThrow();
  });
  it("rejects an unqualified number as historical evidence", async () => {
    const { t, tenant, id } = await fixture();
    now = DUE;
    await expect(
      t.mutation(api.forecasts.settle, { serviceKey: tenant.serviceKey, forecastId: id, observedValue: 101 }),
    ).rejects.toThrow();
  });
});
