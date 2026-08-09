// openportfolio's closed vocabularies, in the spelling and order
// convex/schema.ts uses. Nothing here knows about Convex or zod: each tier
// derives its own validator from these arrays, which is what keeps the package
// importable from plain node and out of the browser's dependency graph.

// What kind of thing an account is. `manual` is not a lesser citizen: a pension
// or an unlisted holding that no API will ever return is still net worth, and
// leaving it out makes the single number wrong in the one direction that
// matters.
export const ACCOUNT_KINDS = ["brokerage", "bank", "exchange", "wallet", "manual"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ASSET_CLASSES = ["equity", "etf", "fund", "bond", "crypto", "cash", "derivative", "other"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

// Tenant membership roles, weakest last. Order is load-bearing: `roleAtLeast`
// reads it as a ranking.
export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export function roleAtLeast(role: MemberRole, minimum: MemberRole): boolean {
  return MEMBER_ROLES.indexOf(role) <= MEMBER_ROLES.indexOf(minimum);
}

// A forecast is open until it resolves. `void` is for a call whose criterion
// became unresolvable (the ticker was delisted, the event was cancelled); it is
// dropped from the Brier mean rather than scored as a miss, and the reason is
// recorded so that dropping one cannot become a habit.
export const FORECAST_STATUSES = ["open", "resolved", "void"] as const;
export type ForecastStatus = (typeof FORECAST_STATUSES)[number];

// The deferred-decision queue. A "wait for event X" conclusion that is not
// written down is a conclusion that gets silently dropped, so it becomes a row
// with a trigger condition and an outcome instead.
export const DECISION_STATUSES = ["open", "done", "void"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

// Investor types as market operators publish them. The four KRX categories map
// onto these one for one, in this order, which is why "other" is a category
// here rather than a fallback: exchanges publish it as its own line.
export const INVESTOR_TYPES = ["retail", "foreign", "institution", "other"] as const;
export type InvestorType = (typeof INVESTOR_TYPES)[number];

export const AUTHOR_TYPES = ["user", "agent"] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

// Every state-changing mutation appends one of these to auditLog. The list is
// closed on purpose: a mutation that has no kind here has not been thought
// about, and the compiler says so at the callsite.
export const AUDIT_KINDS = [
  "tenant.created",
  "member.added",
  "member.removed",
  "serviceKey.issued",
  "serviceKey.revoked",
  "venue.registered",
  "account.linked",
  "account.unlinked",
  "balances.synced",
  "netWorth.snapshot",
  "forecast.emitted",
  "forecast.resolved",
  "forecast.voided",
  "flow.recorded",
  "decision.opened",
  "decision.closed",
  "catalyst.added",
  "order.confirmed",
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export const ORDER_SIDES = ["buy", "sell"] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

// Limit only, by default and by argument: a market order on a thin book is an
// execution decision the operator did not make. An adapter that supports market
// orders declares it, and the caller still has to ask for one.
export const ORDER_TYPES = ["limit", "market"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
