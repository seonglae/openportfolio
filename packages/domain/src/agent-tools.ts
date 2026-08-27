/**
 * What an agent can ask this book, stated once.
 *
 * `mcp/portfolio-server.mjs` has held this list since the beginning, in Zod,
 * for one transport. WebMCP is a second transport for the same 25 questions:
 * a page calls `navigator.modelContext.registerTool()` and an agent attached
 * to the browser can call them without a stdio server, a service key, or an
 * install. Two transports means the list can drift, so it lives here, where
 * `browser/` can import it.
 *
 * The stdio server deliberately does NOT import this. It runs under bare node
 * and a `.ts` specifier would put a node-version floor on all 25 tools, which
 * is the same reason it imports no workspace package at all. What keeps the
 * two honest is `test/webmcp-manifest.test.ts`: it parses the server source
 * and fails when a tool exists on one side and not the other.
 *
 * Schemas are JSON Schema here because that is what WebMCP takes. The server
 * states the same shapes in Zod. The drift test compares names and Convex
 * functions, not schemas: translating Zod to JSON Schema inside a test is more
 * machinery than the guarantee is worth, and a schema that disagrees degrades
 * an argument hint, while a tool that disagrees is a missing capability.
 */

export type JsonSchemaProperty = {
  type: "string" | "number" | "boolean" | "array";
  description?: string;
  enum?: readonly string[];
  items?: { type: "string" };
};

export type JsonSchema = {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
};

export type AgentTool = {
  /** Stable identifier. The same string on both transports. */
  name: string;
  title: string;
  description: string;
  /** The Convex function, named exactly as the backend names it. */
  fn: string;
  /**
   * True when the tool cannot change the book. WebMCP carries this as
   * `annotations.readOnlyHint`, and the public demo registers nothing else:
   * a page on the open internet should not hand an agent a write path.
   */
  readOnly: boolean;
  inputSchema: JsonSchema;
};

const NO_ARGS: JsonSchema = { type: "object", properties: {} };

const str = (description?: string): JsonSchemaProperty => {
  if (description === undefined) return { type: "string" };
  return { type: "string", description };
};

const num = (description?: string): JsonSchemaProperty => {
  if (description === undefined) return { type: "number" };
  return { type: "number", description };
};

const oneOf = (values: readonly string[]): JsonSchemaProperty => ({ type: "string", enum: values });

export const AGENT_TOOLS: readonly AgentTool[] = [
  {
    name: "whoami",
    title: "Who am I",
    description: "The tenant this server is scoped to, and the role it holds.",
    fn: "tenants:whoami",
    readOnly: true,
    inputSchema: NO_ARGS,
  },
  {
    name: "net_worth",
    title: "Net worth",
    description: "Current total in the tenant's base currency, broken down by venue and asset class.",
    fn: "netWorth:current",
    readOnly: true,
    inputSchema: NO_ARGS,
  },
  {
    name: "net_worth_history",
    title: "Net worth history",
    description: "Recorded snapshots, oldest first.",
    fn: "netWorth:history",
    readOnly: true,
    inputSchema: { type: "object", properties: { limit: num() } },
  },
  {
    name: "snapshot_net_worth",
    title: "Snapshot net worth",
    description: "Record the current total as a snapshot. Snapshots are never recomputed afterwards.",
    fn: "netWorth:snapshot",
    readOnly: false,
    inputSchema: NO_ARGS,
  },
  {
    name: "list_accounts",
    title: "List accounts",
    description: "Connected accounts in this tenant.",
    fn: "accounts:list",
    readOnly: true,
    inputSchema: NO_ARGS,
  },
  {
    name: "link_account",
    title: "Link an account",
    description: "Register an account under a stable operator-chosen key. Re-linking keeps its balance history.",
    fn: "accounts:link",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        accountKey: str("stable identifier, e.g. 'isa-hl'"),
        venue: str(),
        kind: oneOf(["brokerage", "bank", "exchange", "wallet", "manual"]),
        label: str(),
        currency: str("ISO code the account reports in, e.g. 'GBP'"),
        note: str(),
      },
      required: ["accountKey", "venue", "kind", "label", "currency"],
    },
  },
  {
    name: "list_balances",
    title: "List balances",
    description: "Positions, optionally for one account.",
    fn: "balances:list",
    readOnly: true,
    inputSchema: { type: "object", properties: { accountKey: str() } },
  },
  {
    name: "symbol_exposure",
    title: "Exposure to one symbol",
    description:
      "The same name held across several accounts, summed. This is the number that matters, not the per-account one.",
    fn: "balances:bySymbol",
    readOnly: true,
    inputSchema: { type: "object", properties: { symbol: str() }, required: ["symbol"] },
  },
  {
    name: "list_venues",
    title: "List venues",
    description: "Registered venues and what each adapter can actually do.",
    fn: "venues:list",
    readOnly: true,
    inputSchema: NO_ARGS,
  },
  {
    name: "list_flows",
    title: "List investor flows",
    description: "Net buying and turnover by investor type, per session.",
    fn: "flows:list",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        market: str(),
        symbol: str(),
        fromDate: str("YYYY-MM-DD"),
        toDate: str("YYYY-MM-DD"),
      },
    },
  },
  {
    name: "flow_by_investor",
    title: "Net flow by investor type",
    description: "Who has been absorbing the supply over a window, rather than what happened on one day.",
    fn: "flows:netByInvestor",
    readOnly: true,
    inputSchema: { type: "object", properties: { market: str(), days: num() }, required: ["market"] },
  },
  {
    name: "record_flow",
    title: "Record a flow row",
    description:
      "One market (or symbol) for one session for one investor type. Restating a session overwrites it rather than double-counting.",
    fn: "flows:record",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        market: str(),
        symbol: str(),
        date: str("YYYY-MM-DD session date"),
        investorType: oneOf(["retail", "foreign", "institution", "other"]),
        netBuyValue: num(),
        turnoverValue: num(),
        currency: str(),
        source: str("where the number came from"),
      },
      required: ["market", "date", "investorType", "netBuyValue", "currency", "source"],
    },
  },
  {
    name: "record_forecast",
    title: "Register a forecast",
    description:
      "A call, with the condition that settles it and the horizon it settles on. Use a machine-resolvable criterion ('BTCUSDT > 100000') whenever the claim allows one; prose criteria have to be settled by hand.",
    fn: "forecasts:emit",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        subject: str(),
        probability: num("0 to 1"),
        horizonSec: num("seconds until it comes due; at least 3600"),
        resolutionCriterion: str(),
        rationale: str(),
        author: str("agent identifier, e.g. 'codex'"),
        authorType: oneOf(["user", "agent"]),
      },
      required: ["subject", "probability", "horizonSec", "resolutionCriterion"],
    },
  },
  {
    name: "list_forecasts",
    title: "List forecasts",
    description: "Registered calls, newest first.",
    fn: "forecasts:list",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { status: oneOf(["open", "resolved", "void"]), author: str(), limit: num() },
    },
  },
  {
    name: "due_forecasts",
    title: "Forecasts past their horizon",
    description:
      "Open calls whose horizon has passed, with the symbol each one needs observed. A null symbol means a human has to read it.",
    fn: "forecasts:listDue",
    readOnly: true,
    inputSchema: { type: "object", properties: { limit: num() } },
  },
  {
    name: "settle_forecast",
    title: "Settle a forecast",
    description:
      "Score a call. Pass observedValue for a machine-resolvable criterion, or outcome to say what happened. An explicit outcome wins.",
    fn: "forecasts:settle",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        forecastId: str(),
        observedValue: num(),
        outcome: { type: "boolean" },
        note: str(),
      },
      required: ["forecastId"],
    },
  },
  {
    name: "void_forecast",
    title: "Void a forecast",
    description:
      "For a call whose criterion became unresolvable. Dropped from the record with a reason, never scored as a miss.",
    fn: "forecasts:voidForecast",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: { forecastId: str(), reason: str() },
      required: ["forecastId", "reason"],
    },
  },
  {
    name: "calibration",
    title: "Calibration and Brier score",
    description:
      "The track record: mean Brier, expected calibration error, and the reliability buckets behind them. 0.25 is the coin-flip line.",
    fn: "forecasts:calibration",
    readOnly: true,
    inputSchema: { type: "object", properties: { windowDays: num(), author: str(), buckets: num() } },
  },
  {
    name: "open_decision",
    title: "Open a deferred decision",
    description:
      "A conclusion with an expiry: what to revisit, and the condition that should trigger it. Anything you would otherwise phrase as 'wait and see' belongs here.",
    fn: "decisions:open",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        key: str(),
        title: str(),
        triggerCondition: str(),
        detail: str(),
        dueAt: num("epoch ms"),
      },
      required: ["key", "title", "triggerCondition"],
    },
  },
  {
    name: "close_decision",
    title: "Close a deferred decision",
    description:
      "Closing requires saying what happened, so an abandoned decision is distinguishable from a settled one.",
    fn: "decisions:close",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: { key: str(), outcome: str(), status: oneOf(["done", "void"]) },
      required: ["key", "outcome"],
    },
  },
  {
    name: "list_decisions",
    title: "List deferred decisions",
    description: "The queue.",
    fn: "decisions:list",
    readOnly: true,
    inputSchema: { type: "object", properties: { status: oneOf(["open", "done", "void"]) } },
  },
  {
    name: "overdue_decisions",
    title: "Overdue decisions",
    description: "Open decisions past their date: the ones that were going to be revisited and were not.",
    fn: "decisions:overdue",
    readOnly: true,
    inputSchema: NO_ARGS,
  },
  {
    name: "add_catalyst",
    title: "Add a catalyst",
    description:
      "A dated forward event and the assets it touches. Lockups, index rebalances, unlocks and earnings are on a schedule, and the schedule is public.",
    fn: "catalysts:add",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        key: str(),
        title: str(),
        at: num("epoch ms"),
        assets: { type: "array", items: { type: "string" } },
        venue: str(),
        source: str(),
        note: str(),
      },
      required: ["key", "title", "at", "assets"],
    },
  },
  {
    name: "upcoming_catalysts",
    title: "Upcoming catalysts",
    description: "Dated events inside a window, optionally filtered to one asset.",
    fn: "catalysts:upcoming",
    readOnly: true,
    inputSchema: { type: "object", properties: { windowDays: num(), asset: str() } },
  },
  {
    name: "audit_tail",
    title: "Audit log",
    description: "Append-only record of every state-changing mutation in this tenant, newest first.",
    fn: "audit:list",
    readOnly: true,
    inputSchema: { type: "object", properties: { kind: str(), limit: num() } },
  },
];

/** The tools that cannot change the book. The only ones the public demo exposes. */
export function readOnlyAgentTools(): readonly AgentTool[] {
  return AGENT_TOOLS.filter((t) => t.readOnly);
}

export function agentToolByName(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}
