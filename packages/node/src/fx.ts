// Foreign exchange, from a keyless public source.
//
// "One net worth" is a single number, and a book spread over a KRW broker, a
// GBP ISA and a USD exchange has three. Converting is therefore not a nicety:
// without it the aggregate is a sum of unlike things. Rates come from
// Frankfurter, which publishes the ECB reference set and needs no key.
//
// One request covers every currency in the book, and the rate is stored on the
// balance row it converted, so a snapshot keeps the rate it was taken at rather
// than being restated at today's.

const DEFAULT_BASE_URL = "https://api.frankfurter.dev/v1";
const DEFAULT_TIMEOUT_MS = 10_000;
const IDENTITY_RATE = 1;

export type FxOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type FrankfurterResponse = { base?: string; date?: string; rates?: Record<string, number> };

// Returns rate(local -> base) for each requested currency: multiply a local
// amount by it to get the base amount. The same currency is always exactly 1,
// never a rate that happens to round to it.
export async function fetchFxRates(
  baseCurrency: string,
  currencies: readonly string[],
  opts: FxOptions = {},
): Promise<Map<string, number>> {
  const base = baseCurrency.toUpperCase();
  const wanted: string[] = [];
  const out = new Map<string, number>([[base, IDENTITY_RATE]]);
  for (const currency of currencies) {
    const upper = currency.toUpperCase();
    if (upper === base || wanted.includes(upper)) continue;
    wanted.push(upper);
  }
  if (wanted.length === 0) return out;

  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${baseUrl}/latest?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(wanted.join(","))}`;
  const res = await doFetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`fx ${res.status} for ${base}`);
  const body = (await res.json()) as FrankfurterResponse;
  const rates = body.rates ?? {};

  for (const currency of wanted) {
    const perBase = rates[currency];
    // The response is "how many local per one base"; the caller needs the
    // inverse. A missing or zero rate is left out rather than inverted into
    // Infinity, which would land in the total as a plausible-looking fortune.
    if (typeof perBase !== "number" || perBase === 0) continue;
    out.set(currency, 1 / perBase);
  }
  return out;
}

// Missing rate means the row cannot be converted. Returning 1 would quietly
// count 100,000 KRW as 100,000 GBP, so the caller has to decide what to do.
export function rateFor(rates: Map<string, number>, currency: string): number | null {
  return rates.get(currency.toUpperCase()) ?? null;
}
