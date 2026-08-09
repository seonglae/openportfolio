import { afterEach, describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import { seedTenant, withConvex } from "./harness.setup";

// The tenant gate is the only thing standing between two people's books in one
// deployment. Every test here is a cross-tenant read that has to fail.

const DEV_TENANT_VAR = "OPENPORTFOLIO_DEV_TENANT";

afterEach(() => {
  delete process.env[DEV_TENANT_VAR];
});

describe("resolving who the caller is", () => {
  it("maps a service key to exactly one tenant", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha", { baseCurrency: "GBP" });
    await seedTenant(t, "beta");

    const who = await t.query(api.tenants.whoami, { serviceKey: alpha.serviceKey });
    expect(who.tenantSlug).toBe("alpha");
    expect(who.baseCurrency).toBe("GBP");
    expect(who.via).toBe("serviceKey");
    // A worker is not a person, and the audit log has to be able to say so.
    expect(who.userId).toBeNull();
  });

  it("resolves an identity through its single membership", async () => {
    const t = withConvex();
    await seedTenant(t, "alpha", { members: [{ userId: "user_a", role: "owner" }] });
    const who = await t.withIdentity({ subject: "user_a" }).query(api.tenants.whoami, {});
    expect(who.tenantSlug).toBe("alpha");
    expect(who.via).toBe("identity");
  });

  it("makes a caller with two books name one rather than guessing", async () => {
    const t = withConvex();
    await seedTenant(t, "alpha", { members: [{ userId: "user_a", role: "owner" }] });
    await seedTenant(t, "beta", { members: [{ userId: "user_a", role: "member" }] });
    const as = t.withIdentity({ subject: "user_a" });
    await expect(as.query(api.tenants.whoami, {})).rejects.toThrow(/ambiguous tenant/);
    expect((await as.query(api.tenants.whoami, { tenantSlug: "beta" })).role).toBe("member");
  });

  it("rejects a caller with no identity, no key and no dev tenant", async () => {
    const t = withConvex();
    await seedTenant(t, "alpha");
    await expect(t.query(api.tenants.whoami, {})).rejects.toThrow(/auth required/);
  });

  // The localhost escape hatch, off unless the operator turns it on.
  it("scopes an unauthenticated caller to the dev tenant when one is named", async () => {
    const t = withConvex();
    await seedTenant(t, "alpha");
    process.env[DEV_TENANT_VAR] = "alpha";
    expect((await t.query(api.tenants.whoami, {})).via).toBe("dev");
  });

  it("stops honouring a revoked key", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("serviceKeys")
        .withIndex("by_tenant", (q) => q.eq("tenantId", alpha.tenantId))
        .first();
      if (row) await ctx.db.patch(row._id, { revokedAt: Date.now() });
    });
    await expect(t.query(api.tenants.whoami, { serviceKey: alpha.serviceKey })).rejects.toThrow(/auth required/);
  });
});

describe("naming another tenant", () => {
  // The client supplies a slug, never a tenantId, and even the slug is only a
  // disambiguator: membership decides.
  it("refuses an identity that names a tenant it does not belong to", async () => {
    const t = withConvex();
    await seedTenant(t, "alpha", { members: [{ userId: "user_a", role: "owner" }] });
    await seedTenant(t, "beta", { members: [{ userId: "user_b", role: "owner" }] });
    await expect(
      t.withIdentity({ subject: "user_a" }).query(api.tenants.whoami, { tenantSlug: "beta" }),
    ).rejects.toThrow(/not found/);
  });

  it("refuses a service key that names a tenant it was not issued for", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    await seedTenant(t, "beta");
    await expect(t.query(api.tenants.whoami, { serviceKey: alpha.serviceKey, tenantSlug: "beta" })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("reading across the boundary", () => {
  it("keeps one tenant's rows out of the other's list", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const beta = await seedTenant(t, "beta");

    await t.mutation(api.accounts.link, {
      serviceKey: alpha.serviceKey,
      accountKey: "alpha-isa",
      venue: "manual",
      kind: "brokerage",
      label: "ISA",
      currency: "GBP",
    });
    await t.mutation(api.accounts.link, {
      serviceKey: beta.serviceKey,
      accountKey: "beta-isa",
      venue: "manual",
      kind: "brokerage",
      label: "ISA",
      currency: "KRW",
    });

    const seenByAlpha = await t.query(api.accounts.list, { serviceKey: alpha.serviceKey });
    expect(seenByAlpha.map((row) => row.accountKey)).toEqual(["alpha-isa"]);
    // Asking for the other tenant's account by its own key returns nothing
    // rather than the row.
    const probe = await t.query(api.accounts.get, { serviceKey: alpha.serviceKey, accountKey: "beta-isa" });
    expect(probe).toBeNull();
  });

  // "forbidden" would confirm the id exists, which is itself the cross-tenant
  // read the gate is meant to prevent. So a foreign row is missing.
  it("reports another tenant's document id as missing, not forbidden", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const beta = await seedTenant(t, "beta");

    const emitted = await t.mutation(api.forecasts.emit, {
      serviceKey: beta.serviceKey,
      subject: "beta's call",
      probability: 0.7,
      horizonSec: 86_400,
      resolutionCriterion: "BTCUSDT > 100000",
    });

    await expect(
      t.mutation(api.forecasts.settle, {
        serviceKey: alpha.serviceKey,
        forecastId: emitted.id,
        observedValue: 120_000,
      }),
    ).rejects.toThrow(/not found/);

    // And it is still open, so the failed reach did not resolve someone else's
    // track record either.
    const stillOpen = await t.query(api.forecasts.list, { serviceKey: beta.serviceKey });
    expect(stillOpen[0].status).toBe("open");
  });

  it("keeps the audit log inside the tenant that produced it", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha");
    const beta = await seedTenant(t, "beta");
    await t.mutation(api.accounts.link, {
      serviceKey: beta.serviceKey,
      accountKey: "beta-isa",
      venue: "manual",
      kind: "brokerage",
      label: "ISA",
      currency: "KRW",
    });
    expect(await t.query(api.audit.list, { serviceKey: alpha.serviceKey })).toEqual([]);
    expect(await t.query(api.audit.list, { serviceKey: beta.serviceKey })).toHaveLength(1);
  });
});

describe("roles", () => {
  it("lets a viewer read and stops it writing", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha", { keyRole: "viewer" });
    await expect(t.query(api.accounts.list, { serviceKey: alpha.serviceKey })).resolves.toEqual([]);
    await expect(
      t.mutation(api.accounts.link, {
        serviceKey: alpha.serviceKey,
        accountKey: "x",
        venue: "manual",
        kind: "manual",
        label: "x",
        currency: "USD",
      }),
    ).rejects.toThrow(/role viewer is below member/);
  });

  it("keeps a member out of the admin surface", async () => {
    const t = withConvex();
    const alpha = await seedTenant(t, "alpha", { keyRole: "member" });
    await expect(t.query(api.tenants.listServiceKeys, { serviceKey: alpha.serviceKey })).rejects.toThrow(
      /role member is below admin/,
    );
  });
});
