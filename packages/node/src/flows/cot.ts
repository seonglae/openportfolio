// Commitments of Traders: who is positioned which way, by participant class.
//
// The flows pillar had a schema, a mutation and a view, and nothing writing a
// row. The obvious sources are the wrong shape for a global tool: daily net
// buying split by investor type is an Asian market-structure disclosure, and
// wiring one exchange's feed would make the pillar work in one country.
//
// COT is the closest thing the rest of the world publishes. It is weekly rather
// than daily and it covers futures rather than cash equities, and in exchange it
// is free, keyless, official, and it separates the participants the same way the
// question does: who is hedging, who is speculating with size, and who is small.
//
// The unit is contracts, not money, and that travels on the row rather than
// being converted. A notional needs a contract multiplier and a settlement price
// per market per week, and every one of those is another thing to be wrong
// about; "12,000 contracts" is a fact, "$3.1bn" would be an estimate wearing a
// fact's clothes.

const DEFAULT_BASE_URL = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_WEEKS = 8;
export const COT_SOURCE = "CFTC COT";
export const COT_UNIT = "contracts";

// The contract codes are the CFTC's own, read off the endpoint rather than
// typed from memory: a wrong code returns another market's positioning without
// erroring, which is a fact about the wrong thing.
export type CotMarket = { code: string; market: string; label: string };

export const COT_MARKETS: readonly CotMarket[] = [
  { code: "13874A", market: "ES", label: "E-mini S&P 500" },
  { code: "209742", market: "NQ", label: "Nasdaq mini" },
  { code: "239742", market: "RTY", label: "Russell E-mini" },
  { code: "043602", market: "ZN", label: "UST 10Y note" },
  { code: "042601", market: "ZT", label: "UST 2Y note" },
  { code: "088691", market: "GC", label: "Gold" },
  { code: "084691", market: "SI", label: "Silver" },
  { code: "067651", market: "CL", label: "WTI crude" },
  { code: "098662", market: "DX", label: "US dollar index" },
  { code: "099741", market: "6E", label: "Euro FX" },
  { code: "097741", market: "6J", label: "Japanese yen" },
  { code: "096742", market: "6B", label: "British pound" },
  { code: "133741", market: "BTC", label: "Bitcoin (CME)" },
];

// COT's three participant classes onto the vocabulary the flows table already
// has. Non-reportable means a position too small to have to report, which is
// retail by construction. Non-commercial is the large speculator: managed money
// and the funds. Commercial is the hedger, a producer or a dealer with the
// underlying exposure, and it is genuinely a fourth thing rather than a kind of
// institution, so it lands on `other` rather than being flattened into one.
//
// `foreign` never appears: COT reports what a participant is, not where it is.
export type InvestorType = "retail" | "foreign" | "institution" | "other";

type ClassMapping = { investorType: InvestorType; longField: string; shortField: string };

const CLASSES: readonly ClassMapping[] = [
  { investorType: "institution", longField: "change_in_noncomm_long_all", shortField: "change_in_noncomm_short_all" },
  { investorType: "other", longField: "change_in_comm_long_all", shortField: "change_in_comm_short_all" },
  { investorType: "retail", longField: "change_in_nonrept_long_all", shortField: "change_in_nonrept_short_all" },
];

export type CotRow = Record<string, string | undefined>;

export type FlowRow = {
  market: string;
  date: string;
  investorType: InvestorType;
  // The week's change in net position, long minus short, in contracts. The
  // level is a position; the change is the flow, and the flow is the question.
  netBuyValue: number;
  turnoverValue?: number;
  currency: string;
  source: string;
};

// Socrata answers with strings, including for the numbers.
function num(row: CotRow, field: string): number | null {
  const raw = row[field];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return value;
}

// "2026-08-11T00:00:00.000" is a report date, not an instant. The flows table
// keys on a session date string for the same reason: an epoch invites timezone
// drift into a series that is published per period.
export function reportDay(raw: string): string {
  return raw.slice(0, 10);
}

export function flowRowsFrom(market: string, rows: readonly CotRow[]): FlowRow[] {
  const out: FlowRow[] = [];
  for (const row of rows) {
    const reported = row.report_date_as_yyyy_mm_dd;
    if (!reported) continue;
    const date = reportDay(reported);
    const openInterest = num(row, "open_interest_all") ?? undefined;
    for (const cls of CLASSES) {
      const long = num(row, cls.longField);
      const short = num(row, cls.shortField);
      // A week the CFTC did not publish a change for is skipped rather than
      // recorded as zero, which would read as "nobody moved".
      if (long === null || short === null) continue;
      out.push({
        market,
        date,
        investorType: cls.investorType,
        netBuyValue: long - short,
        turnoverValue: openInterest,
        currency: COT_UNIT,
        source: COT_SOURCE,
      });
    }
  }
  return out;
}

export type CotOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  weeks?: number;
  markets?: readonly CotMarket[];
};

export async function fetchCotFlows(opts: CotOptions = {}): Promise<FlowRow[]> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const weeks = opts.weeks ?? DEFAULT_WEEKS;
  const markets = opts.markets ?? COT_MARKETS;

  const out: FlowRow[] = [];
  for (const market of markets) {
    const params = new URLSearchParams({
      $where: `cftc_contract_market_code='${market.code}'`,
      $order: "report_date_as_yyyy_mm_dd DESC",
      $limit: String(weeks),
    });
    const res = await doFetch(`${baseUrl}?${params.toString()}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`cftc ${res.status} for ${market.market} (${market.code})`);
    const rows = (await res.json()) as CotRow[];
    // An empty answer means the code no longer names a live contract. Saying so
    // is the point: silence would leave a market quietly missing from a series
    // that is read as complete.
    if (rows.length === 0) throw new Error(`cftc returned no report for ${market.market} (${market.code})`);
    out.push(...flowRowsFrom(market.market, rows));
  }
  return out;
}
