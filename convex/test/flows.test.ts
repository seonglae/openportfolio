import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import { seedTenant, withConvex } from "./harness.setup";

const LEGACY_COT = {
  market: "ES",
  date: "2026-01-06",
  investorType: "retail" as const,
  netBuyValue: 20,
  turnoverValue: 1000,
  currency: "contracts",
  source: "CFTC COT",
};
describe("flow meaning and provenance", () => {
  it("normalizes legacy COT reads without calling interest turnover or traders retail", async () => {
    const t = withConvex();
    const tenant = await seedTenant(t, "alpha");
    await t.run(async (ctx) => {
      await ctx.db.insert("flows", { ...LEGACY_COT, tenantId: tenant.tenantId, createdAt: 1 });
    });
    const rows = await t.query(api.flows.list, { serviceKey: tenant.serviceKey, market: "ES" });
    expect(rows[0]).toMatchObject({
      investorType: "non_reportable",
      openInterestContracts: 1000,
      measurement: "net_position_change",
    });
    expect(rows[0].turnoverValue).toBeUndefined();
    const net = await t.query(api.flows.netByInvestor, { serviceKey: tenant.serviceKey, market: "ES" });
    expect(net).toMatchObject({
      currency: "contracts",
      sessions: 1,
      measurement: "net_position_change",
      byInvestor: [{ investorType: "non_reportable", netBuyValue: 20 }],
    });
  });
  it("replaces a normalized legacy class once and audits restatements", async () => {
    const t = withConvex();
    const tenant = await seedTenant(t, "alpha");
    await t.run(async (ctx) => {
      await ctx.db.insert("flows", { ...LEGACY_COT, tenantId: tenant.tenantId, createdAt: 1 });
    });
    await t.mutation(api.flows.record, {
      ...LEGACY_COT,
      serviceKey: tenant.serviceKey,
      investorType: "non_reportable",
      netBuyValue: 25,
      turnoverValue: undefined,
      openInterestContracts: 1050,
      measurement: "net_position_change",
    });
    const rows = await t.query(api.flows.list, { serviceKey: tenant.serviceKey });
    expect(rows).toHaveLength(1);
    expect(rows[0].netBuyValue).toBe(25);
    expect(rows[0].openInterestContracts).toBe(1050);
    expect(await t.query(api.audit.list, { serviceKey: tenant.serviceKey, kind: "flow.recorded" })).toHaveLength(1);
  });
  it("never adds contracts to currency or mixes independent sources", async () => {
    const t = withConvex();
    const tenant = await seedTenant(t, "alpha");
    await t.mutation(api.flows.record, { ...LEGACY_COT, serviceKey: tenant.serviceKey });
    await t.mutation(api.flows.record, {
      ...LEGACY_COT,
      serviceKey: tenant.serviceKey,
      source: "cash exchange",
      currency: "USD",
    });
    expect(await t.query(api.flows.netByInvestor, { serviceKey: tenant.serviceKey, market: "ES" })).toMatchObject({
      measurement: "mixed",
      byInvestor: [],
      warning: expect.stringContaining("Cannot aggregate"),
    });
    const beta = await seedTenant(t, "beta");
    expect(await t.query(api.flows.list, { serviceKey: beta.serviceKey })).toEqual([]);
  });
});
