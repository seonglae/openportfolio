import { describe, expect, it } from "vitest";
import { UNSUPPORTED_CAPABILITY, assertCapability, type VenueAdapter } from "../src/adapter.ts";

const quoteOnly: VenueAdapter = {
  venue: "quotes-only",
  kind: "manual",
  capabilities: { canReadBalances: false, canReadQuotes: true, canPlaceOrders: false },
  readBalances: async () => [],
  readQuote: async () => ({ symbol: "X", price: 1, currency: "USD", asOf: 0 }),
};

describe("capability checks", () => {
  it("lets a declared capability through", () => {
    expect(() => assertCapability(quoteOnly, "canReadQuotes")).not.toThrow();
  });

  // A quote source that returns [] for balances would otherwise read as "you
  // hold nothing", which is a wrong net worth rather than a missing one.
  it("refuses an undeclared capability at the boundary", () => {
    expect(() => assertCapability(quoteOnly, "canReadBalances")).toThrow(/does not support canReadBalances/);
  });

  it("tags the failure so a runner can tell it apart from a venue outage", () => {
    try {
      assertCapability(quoteOnly, "canPlaceOrders");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as { code?: string }).code).toBe(UNSUPPORTED_CAPABILITY);
    }
  });

  it("refuses an adapter that claims order placement without implementing it", () => {
    const liar: VenueAdapter = {
      ...quoteOnly,
      venue: "liar",
      capabilities: { canReadBalances: false, canReadQuotes: true, canPlaceOrders: true },
    };
    expect(() => assertCapability(liar, "canPlaceOrders")).toThrow(/does not support/);
  });
});
