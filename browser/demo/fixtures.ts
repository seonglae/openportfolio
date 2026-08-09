// Fixture book for the public demo and the screenshots.
//
// Every number here is invented. No real account, holding or balance appears in
// this file, and none ever should: it is compiled into a page served from the
// open internet. Treat it as marketing copy that happens to be typed as data.
//
// Totals are derived from the positions rather than written twice, so the
// headline always agrees with the table under it.

const DAY = 86_400_000;
const BASE = "GBP";

// A fixed hour of the day, so a screenshot taken twice looks the same.
const today = new Date();
today.setUTCHours(16, 30, 0, 0);
const NOW = today.getTime();

const day = (offset: number) => NOW + offset * DAY;
const isoDay = (offset: number) => new Date(day(offset)).toISOString().slice(0, 10);

export type DemoPosition = {
  accountKey: string;
  symbol: string;
  assetClass: string;
  qty: number;
  lastPrice: number;
  currency: string;
  valueBase: number;
  asOf: number;
};

const POSITIONS: DemoPosition[] = [
  {
    accountKey: "isa",
    symbol: "VWRL",
    assetClass: "etf",
    qty: 340,
    lastPrice: 118.2,
    currency: "GBP",
    valueBase: 40188,
    asOf: day(0),
  },
  {
    accountKey: "isa",
    symbol: "CSPX",
    assetClass: "etf",
    qty: 42,
    lastPrice: 754.1,
    currency: "GBP",
    valueBase: 31672.2,
    asOf: day(0),
  },
  {
    accountKey: "gia",
    symbol: "NVDA",
    assetClass: "equity",
    qty: 45,
    lastPrice: 223.96,
    currency: "USD",
    valueBase: 7489.14,
    asOf: day(0),
  },
  {
    accountKey: "gia",
    symbol: "MSFT",
    assetClass: "equity",
    qty: 60,
    lastPrice: 354.3,
    currency: "USD",
    valueBase: 15794.72,
    asOf: day(0),
  },
  {
    accountKey: "gia",
    symbol: "ASML",
    assetClass: "equity",
    qty: 18,
    lastPrice: 812.4,
    currency: "EUR",
    valueBase: 12184.15,
    asOf: day(0),
  },
  {
    accountKey: "gia",
    symbol: "035420",
    assetClass: "equity",
    qty: 210,
    lastPrice: 231000,
    currency: "KRW",
    valueBase: 27012.19,
    asOf: day(0),
  },
  {
    accountKey: "wallet",
    symbol: "BTC",
    assetClass: "crypto",
    qty: 0.184,
    lastPrice: 65012,
    currency: "USD",
    valueBase: 8892.03,
    asOf: day(0),
  },
  {
    accountKey: "wallet",
    symbol: "ETH",
    assetClass: "crypto",
    qty: 3.2,
    lastPrice: 3410,
    currency: "USD",
    valueBase: 8112.51,
    asOf: day(0),
  },
  {
    accountKey: "pension",
    symbol: "WORKPLACE-DC",
    assetClass: "pension",
    qty: 1,
    lastPrice: 26500,
    currency: "GBP",
    valueBase: 26500,
    asOf: day(-3),
  },
  {
    accountKey: "current",
    symbol: "GBP",
    assetClass: "cash",
    qty: 5195,
    lastPrice: 1,
    currency: "GBP",
    valueBase: 5195,
    asOf: day(0),
  },
];

const ACCOUNTS = [
  { accountKey: "isa", venue: "ibkr", kind: "brokerage", label: "Stocks & Shares ISA", currency: "GBP" },
  { accountKey: "gia", venue: "ibkr", kind: "brokerage", label: "General investment", currency: "GBP" },
  { accountKey: "wallet", venue: "coingecko", kind: "wallet", label: "Self-custody wallet", currency: "USD" },
  { accountKey: "pension", venue: "manual", kind: "pension", label: "Workplace pension", currency: "GBP" },
  { accountKey: "current", venue: "manual", kind: "bank", label: "Current account", currency: "GBP" },
];

const venueOf = new Map(ACCOUNTS.map((a) => [a.accountKey, a.venue]));

function groupBy(key: (p: DemoPosition) => string) {
  const sums = new Map<string, number>();
  for (const p of POSITIONS) {
    const k = key(p);
    sums.set(k, (sums.get(k) ?? 0) + p.valueBase);
  }
  return [...sums.entries()].sort((a, b) => b[1] - a[1]);
}

const TOTAL = POSITIONS.reduce((sum, p) => sum + p.valueBase, 0);

// A drawdown and a recovery, so the series has a shape worth plotting rather
// than a straight line up and to the right.
const HISTORY_DAYS = 30;
const SHAPE = [
  1.0, 0.995, 0.998, 0.987, 0.972, 0.96, 0.951, 0.943, 0.951, 0.938, 0.929, 0.941, 0.955, 0.948, 0.962, 0.971, 0.968,
  0.977, 0.985, 0.979, 0.988, 0.996, 1.004, 0.999, 1.008, 1.014, 1.011, 1.019, 1.024, 1.0,
];

export const FIXTURES: Record<string, unknown> = {
  "tenants:whoami": { tenantSlug: "demo", tenantName: "Demo book", role: "viewer" },

  "netWorth:current": {
    totalBase: TOTAL,
    baseCurrency: BASE,
    accountCount: ACCOUNTS.length,
    byVenue: groupBy((p) => venueOf.get(p.accountKey) ?? "unlinked").map(([venue, valueBase]) => ({
      venue,
      valueBase,
    })),
    byAssetClass: groupBy((p) => p.assetClass).map(([assetClass, valueBase]) => ({ assetClass, valueBase })),
  },

  "netWorth:history": SHAPE.map((factor, i) => ({
    _id: `snap-${i}`,
    at: day(i - (HISTORY_DAYS - 1)),
    totalBase: Math.round(TOTAL * factor * 100) / 100,
    baseCurrency: BASE,
  })),

  "accounts:list": ACCOUNTS,
  "balances:list": POSITIONS,

  "flows:netByInvestor": {
    sessions: 30,
    currency: "KRW",
    byInvestor: [
      { investorType: "individual", netBuyValue: 7_218_000_000_000 },
      { investorType: "institution", netBuyValue: -1_884_000_000_000 },
      { investorType: "foreigner", netBuyValue: -5_602_000_000_000 },
      { investorType: "other_corporation", netBuyValue: 268_000_000_000 },
    ],
  },

  "flows:list": [
    {
      _id: "f1",
      date: isoDay(-1),
      investorType: "foreigner",
      netBuyValue: -811_400_000_000,
      turnoverValue: 37_412_000_000_000,
      source: "exchange",
    },
    {
      _id: "f2",
      date: isoDay(-1),
      investorType: "individual",
      netBuyValue: 206_900_000_000,
      turnoverValue: 37_412_000_000_000,
      source: "exchange",
    },
    {
      _id: "f3",
      date: isoDay(-1),
      investorType: "institution",
      netBuyValue: 598_300_000_000,
      turnoverValue: 37_412_000_000_000,
      source: "exchange",
    },
    {
      _id: "f4",
      date: isoDay(-2),
      investorType: "foreigner",
      netBuyValue: -2_967_500_000_000,
      turnoverValue: 41_265_000_000_000,
      source: "exchange",
    },
    {
      _id: "f5",
      date: isoDay(-2),
      investorType: "individual",
      netBuyValue: 3_104_800_000_000,
      turnoverValue: 41_265_000_000_000,
      source: "exchange",
    },
    {
      _id: "f6",
      date: isoDay(-2),
      investorType: "institution",
      netBuyValue: -241_600_000_000,
      turnoverValue: 41_265_000_000_000,
      source: "exchange",
    },
    {
      _id: "f7",
      date: isoDay(-3),
      investorType: "foreigner",
      netBuyValue: 1_744_200_000_000,
      turnoverValue: 43_118_000_000_000,
      source: "exchange",
    },
    {
      _id: "f8",
      date: isoDay(-3),
      investorType: "individual",
      netBuyValue: -1_602_700_000_000,
      turnoverValue: 43_118_000_000_000,
      source: "exchange",
    },
    {
      _id: "f9",
      date: isoDay(-3),
      investorType: "institution",
      netBuyValue: -133_900_000_000,
      turnoverValue: 43_118_000_000_000,
      source: "exchange",
    },
    {
      _id: "f10",
      date: isoDay(-4),
      investorType: "foreigner",
      netBuyValue: -722_100_000_000,
      turnoverValue: 45_007_000_000_000,
      source: "exchange",
    },
    {
      _id: "f11",
      date: isoDay(-4),
      investorType: "individual",
      netBuyValue: 934_600_000_000,
      turnoverValue: 45_007_000_000_000,
      source: "exchange",
    },
    {
      _id: "f12",
      date: isoDay(-4),
      investorType: "institution",
      netBuyValue: -286_400_000_000,
      turnoverValue: 45_007_000_000_000,
      source: "exchange",
    },
  ],

  // Slightly overconfident at the top end, which is the usual failure and the
  // thing the diagram is supposed to expose.
  "forecasts:calibration": {
    n: 74,
    meanBrier: 0.187,
    randomBaseline: 0.25,
    expectedCalibrationError: 0.068,
    buckets: [
      { lower: 0.0, upper: 0.2, count: 9, meanProbability: 0.12, observedRate: 0.111 },
      { lower: 0.2, upper: 0.4, count: 14, meanProbability: 0.31, observedRate: 0.286 },
      { lower: 0.4, upper: 0.6, count: 19, meanProbability: 0.51, observedRate: 0.526 },
      { lower: 0.6, upper: 0.8, count: 21, meanProbability: 0.68, observedRate: 0.619 },
      { lower: 0.8, upper: 1.0, count: 11, meanProbability: 0.87, observedRate: 0.727 },
    ],
  },

  // Subjects are drawn from the fixture book above, never from a real registered
  // call. An invented holding is easy to see; an invented forecast is not, and a
  // list of genuine calls with their real levels and dates is a research record
  // whether or not it names a position.
  "forecasts:list": [
    {
      _id: "c1",
      subject: "MSFT",
      resolutionCriterion: "MSFT close > 520.00",
      probability: 0.55,
      status: "resolved",
      brier: 0.203,
      dueAt: day(-2),
    },
    {
      _id: "c2",
      subject: "Euro area CPI",
      resolutionCriterion: "HICP yoy < 2.2",
      probability: 0.66,
      status: "resolved",
      brier: 0.116,
      dueAt: day(-2),
    },
    {
      _id: "c3",
      subject: "VWRL",
      resolutionCriterion: "VWRL close > 124.00",
      probability: 0.61,
      status: "open",
      brier: null,
      dueAt: day(89),
    },
    {
      _id: "c4",
      subject: "035420",
      resolutionCriterion: "035420 close > 210000",
      probability: 0.49,
      status: "open",
      brier: null,
      dueAt: day(4),
    },
    {
      _id: "c5",
      subject: "ETH",
      resolutionCriterion: "ETHUSD > 4000",
      probability: 0.37,
      status: "open",
      brier: null,
      dueAt: day(23),
    },
    {
      _id: "c6",
      subject: "Gold",
      resolutionCriterion: "XAUUSD > 4500",
      probability: 0.44,
      status: "open",
      brier: null,
      dueAt: day(31),
    },
    {
      _id: "c7",
      subject: "ASML",
      resolutionCriterion: "ASML bookings beat consensus",
      probability: 0.58,
      status: "resolved",
      brier: 0.176,
      dueAt: day(-19),
    },
  ],

  "decisions:list": [
    {
      key: "semis-review",
      title: "Semiconductor hold review",
      detail: "Held until the book is at cost plus the target, not until one name recovers.",
      triggerCondition: "first of each month",
      dueAt: day(-6),
    },
    {
      key: "cpi-reentry",
      title: "Re-enter the metals tranche after CPI",
      detail: "Deferred once already. Deferring twice is a decision to skip it.",
      triggerCondition: "CPI print clears",
      dueAt: day(2),
    },
    {
      key: "pension-consolidate",
      title: "Consolidate the old workplace pension",
      detail: "Manual row until the provider exposes an API.",
      triggerCondition: "provider statement arrives",
      dueAt: day(17),
    },
    {
      key: "rebalance-etf",
      title: "Trim the ETF overweight",
      detail: "ETF share is above the band written at the last review.",
      triggerCondition: "quarterly rebalance",
      dueAt: day(44),
    },
  ],

  "decisions:overdue": [{ key: "semis-review" }],

  "catalysts:upcoming": [
    { key: "hicp", title: "Euro area flash HICP", assets: ["ASML", "CSPX"], at: day(2) },
    { key: "13f", title: "13F filing deadline", assets: ["NVDA", "MSFT"], at: day(3) },
    { key: "asml-q", title: "ASML quarterly results", assets: ["ASML"], at: day(12) },
    { key: "msci", title: "MSCI quarterly rebalance", assets: ["035420", "VWRL"], at: day(26) },
    { key: "fomc", title: "FOMC decision", assets: ["VWRL", "CSPX", "BTC"], at: day(38) },
    { key: "boe", title: "Bank of England decision", assets: ["VWRL", "GBP"], at: day(51) },
  ],
};
