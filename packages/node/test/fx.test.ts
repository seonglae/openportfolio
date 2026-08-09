import { describe, expect, it } from "vitest";
import { fetchFxRates, rateFor } from "../src/fx.ts";

function stubFetch(body: unknown, ok = true) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    return { ok, status: ok ? 200 : 500, json: async () => body };
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("converting a book to one currency", () => {
  it("inverts the published rate, because the caller has the local amount", async () => {
    const { impl } = stubFetch({ base: "GBP", rates: { USD: 1.25, KRW: 1800 } });
    const rates = await fetchFxRates("GBP", ["USD", "KRW"], { fetchImpl: impl });
    // 1.25 USD per GBP means one USD is 0.8 GBP.
    expect(rates.get("USD")).toBeCloseTo(0.8, 10);
    expect(rates.get("KRW")).toBeCloseTo(1 / 1800, 12);
  });

  it("gives the base currency exactly 1, not a rounded rate", async () => {
    const { impl, calls } = stubFetch({ rates: {} });
    const rates = await fetchFxRates("GBP", ["GBP", "gbp"], { fetchImpl: impl });
    expect(rates.get("GBP")).toBe(1);
    // Nothing to ask for, so nothing is asked.
    expect(calls).toHaveLength(0);
  });

  it("asks once for every currency in the book", async () => {
    const { impl, calls } = stubFetch({ rates: { USD: 1.25, KRW: 1800 } });
    await fetchFxRates("GBP", ["USD", "KRW", "USD"], { fetchImpl: impl });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("symbols=USD%2CKRW");
  });

  // Inverting a zero would put Infinity in the total, which reads as a fortune.
  it("leaves out a rate it cannot invert rather than inventing one", async () => {
    const { impl } = stubFetch({ rates: { USD: 0, JPY: null } });
    const rates = await fetchFxRates("GBP", ["USD", "JPY"], { fetchImpl: impl });
    expect(rateFor(rates, "USD")).toBeNull();
    expect(rateFor(rates, "JPY")).toBeNull();
  });

  it("raises the status when the source is down", async () => {
    const { impl } = stubFetch({}, false);
    await expect(fetchFxRates("GBP", ["USD"], { fetchImpl: impl })).rejects.toThrow(/fx 500/);
  });
});
