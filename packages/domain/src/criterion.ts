// Resolution criteria, and the parser that makes them machine-resolvable.
//
// A forecast without a criterion is a story: it can be remembered generously
// and never scored. The criterion is what turns "I think semis are strong" into
// "SOX > 6000", which either happened or did not. The simple form parsed here
// is `SYMBOL <comparator> VALUE`; anything richer stays human-resolved, and the
// resolver leaves it alone rather than guessing.

// Two-character comparators come first so the alternation cannot match ">" out
// of ">=" and leave "=" behind.
export const COMPARATORS = [">=", "<=", "==", "!=", ">", "<"] as const;
export type Comparator = (typeof COMPARATORS)[number];

export type Criterion = { symbol: string; comparator: Comparator; value: number };

// Symbols in the wild carry dots, colons, slashes and dashes: `035420.KS`,
// `KRX:035420`, `BTC/USD`, `BRK-B`.
const CRITERION_PATTERN = /^\s*([A-Za-z0-9._:/^-]+)\s*(>=|<=|==|!=|=|>|<)\s*(-?[\d,_]*\.?\d+)\s*$/;

// A single "=" reads as equality to everyone who is not a compiler.
const COMPARATOR_ALIASES: Record<string, Comparator> = {
  ">=": ">=",
  "<=": "<=",
  "==": "==",
  "!=": "!=",
  "=": "==",
  ">": ">",
  "<": "<",
};

const COMPARE: Record<Comparator, (observed: number, target: number) => boolean> = {
  ">=": (observed, target) => observed >= target,
  "<=": (observed, target) => observed <= target,
  "==": (observed, target) => observed === target,
  "!=": (observed, target) => observed !== target,
  ">": (observed, target) => observed > target,
  "<": (observed, target) => observed < target,
};

// Null, not a throw: most criteria are prose, and prose is a valid way to
// register a call as long as a human resolves it. Returning null is how the
// resolver learns to skip a row instead of failing a cron.
export function parseCriterion(text: string): Criterion | null {
  const match = CRITERION_PATTERN.exec(text);
  if (!match) return null;
  const [, symbol, rawComparator, rawValue] = match;
  const comparator = COMPARATOR_ALIASES[rawComparator];
  if (!comparator) return null;
  // Thousands separators are how people actually write levels ("KOSPI > 3,000").
  const value = Number(rawValue.replace(/[,_]/g, ""));
  if (!Number.isFinite(value)) return null;
  return { symbol: symbol.toUpperCase(), comparator, value };
}

export function evaluateCriterion(criterion: Criterion, observed: number): boolean {
  return COMPARE[criterion.comparator](observed, criterion.value);
}

export function formatCriterion(criterion: Criterion): string {
  return `${criterion.symbol} ${criterion.comparator} ${criterion.value}`;
}

// The symbol a criterion needs an observation for, or null when the criterion
// is prose. Callers use this to decide which quotes to fetch before resolving.
export function criterionSymbol(text: string): string | null {
  const parsed = parseCriterion(text);
  if (!parsed) return null;
  return parsed.symbol;
}
