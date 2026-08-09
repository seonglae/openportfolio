#!/usr/bin/env node
// portfolio-mcp: stdio MCP server that lets an agent CLI read and write one
// tenant's book.
//
// Every tool call goes through the same tenant-scoped Convex functions the
// dashboard uses, with the service key injected from the environment. The
// server therefore cannot reach outside the tenant its key was issued for, and
// there is no tool here that places an order, because the backend has no
// function that does.
//
// Run directly:  node mcp/portfolio-server.mjs
// Reads CONVEX_DEPLOYMENT, OPENPORTFOLIO_SERVICE_KEY and (optionally)
// OPENPORTFOLIO_TENANT from the environment, or from .env.local beside it.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileP = promisify(execFile);

const PROJECT_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CONVEX_BIN = resolve(PROJECT_ROOT, "node_modules/.bin/convex");
const CALL_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024;

// Minimal .env.local read: this file runs under bare node and deliberately
// imports no workspace package, so the ~25 tools below never impose a node
// version floor through a .ts specifier.
function loadEnvLocal() {
  try {
    const text = readFileSync(resolve(PROJECT_ROOT, ".env.local"), "utf8");
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // No .env.local is normal when the environment is exported directly.
  }
}
loadEnvLocal();

// No fallback on purpose: a wrong deployment name fails with a confusing
// "function not found" from someone else's backend, so an unset one stops here.
const DEPLOYMENT = process.env.CONVEX_DEPLOYMENT;
const SERVICE_KEY = process.env.OPENPORTFOLIO_SERVICE_KEY;
const TENANT_SLUG = process.env.OPENPORTFOLIO_TENANT;

async function convex(fn, args = {}) {
  const withAuth = { ...args };
  if (SERVICE_KEY && withAuth.serviceKey == null) withAuth.serviceKey = SERVICE_KEY;
  if (TENANT_SLUG && withAuth.tenantSlug == null) withAuth.tenantSlug = TENANT_SLUG;
  const { stdout } = await execFileP(CONVEX_BIN, ["run", fn, JSON.stringify(withAuth)], {
    cwd: PROJECT_ROOT,
    // Only override when we actually have one: passing undefined through
    // reaches the CLI as the string "undefined" and beats the .env.local it
    // would otherwise have read for itself.
    env: DEPLOYMENT ? { ...process.env, CONVEX_DEPLOYMENT: DEPLOYMENT } : process.env,
    timeout: CALL_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function asContent(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function asError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: msg }] };
}

const server = new McpServer({ name: "portfolio-mcp", version: "0.1.0" });

// One registration helper rather than 25 copies of the same try/catch. Tool
// arguments are named exactly as the Convex function names them, so there is
// nothing to map between the two.
function tool(name, title, description, inputSchema, fn) {
  server.registerTool(name, { title, description, inputSchema }, async (args) => {
    try {
      return asContent(await convex(fn, args));
    } catch (e) {
      return asError(e);
    }
  });
}

// ── Identity ────────────────────────────────────────────────────────────

tool("whoami", "Who am I", "The tenant this server is scoped to, and the role it holds.", {}, "tenants:whoami");

// ── One net worth ───────────────────────────────────────────────────────

tool(
  "net_worth",
  "Net worth",
  "Current total in the tenant's base currency, broken down by venue and asset class.",
  {},
  "netWorth:current",
);

tool(
  "net_worth_history",
  "Net worth history",
  "Recorded snapshots, oldest first.",
  { limit: z.number().optional() },
  "netWorth:history",
);

tool(
  "snapshot_net_worth",
  "Snapshot net worth",
  "Record the current total as a snapshot. Snapshots are never recomputed afterwards.",
  {},
  "netWorth:snapshot",
);

tool("list_accounts", "List accounts", "Connected accounts in this tenant.", {}, "accounts:list");

tool(
  "link_account",
  "Link an account",
  "Register an account under a stable operator-chosen key. Re-linking keeps its balance history.",
  {
    accountKey: z.string().describe("stable identifier, e.g. 'isa-hl'"),
    venue: z.string(),
    kind: z.enum(["brokerage", "bank", "exchange", "wallet", "manual"]),
    label: z.string(),
    currency: z.string().describe("ISO code the account reports in, e.g. 'GBP'"),
    note: z.string().optional(),
  },
  "accounts:link",
);

tool(
  "list_balances",
  "List balances",
  "Positions, optionally for one account.",
  { accountKey: z.string().optional() },
  "balances:list",
);

tool(
  "symbol_exposure",
  "Exposure to one symbol",
  "The same name held across several accounts, summed. This is the number that matters, not the per-account one.",
  { symbol: z.string() },
  "balances:bySymbol",
);

tool("list_venues", "List venues", "Registered venues and what each adapter can actually do.", {}, "venues:list");

// ── Flows ───────────────────────────────────────────────────────────────

tool(
  "list_flows",
  "List investor flows",
  "Net buying and turnover by investor type, per session.",
  {
    market: z.string().optional(),
    symbol: z.string().optional(),
    fromDate: z.string().optional().describe("YYYY-MM-DD"),
    toDate: z.string().optional().describe("YYYY-MM-DD"),
  },
  "flows:list",
);

tool(
  "flow_by_investor",
  "Net flow by investor type",
  "Who has been absorbing the supply over a window, rather than what happened on one day.",
  { market: z.string(), days: z.number().optional() },
  "flows:netByInvestor",
);

tool(
  "record_flow",
  "Record a flow row",
  "One market (or symbol) for one session for one investor type. Restating a session overwrites it rather than double-counting.",
  {
    market: z.string(),
    symbol: z.string().optional(),
    date: z.string().describe("YYYY-MM-DD session date"),
    investorType: z.enum(["retail", "foreign", "institution", "other"]),
    netBuyValue: z.number(),
    turnoverValue: z.number().optional(),
    currency: z.string(),
    source: z.string().describe("where the number came from"),
  },
  "flows:record",
);

// ── The track record ────────────────────────────────────────────────────

tool(
  "record_forecast",
  "Register a forecast",
  "A call, with the condition that settles it and the horizon it settles on. Use a machine-resolvable criterion ('BTCUSDT > 100000') whenever the claim allows one; prose criteria have to be settled by hand.",
  {
    subject: z.string(),
    probability: z.number().describe("0 to 1"),
    horizonSec: z.number().describe("seconds until it comes due; at least 3600"),
    resolutionCriterion: z.string(),
    rationale: z.string().optional(),
    author: z.string().optional().describe("agent identifier, e.g. 'codex'"),
    authorType: z.enum(["user", "agent"]).optional(),
  },
  "forecasts:emit",
);

tool(
  "list_forecasts",
  "List forecasts",
  "Registered calls, newest first.",
  {
    status: z.enum(["open", "resolved", "void"]).optional(),
    author: z.string().optional(),
    limit: z.number().optional(),
  },
  "forecasts:list",
);

tool(
  "due_forecasts",
  "Forecasts past their horizon",
  "Open calls whose horizon has passed, with the symbol each one needs observed. A null symbol means a human has to read it.",
  { limit: z.number().optional() },
  "forecasts:listDue",
);

tool(
  "settle_forecast",
  "Settle a forecast",
  "Score a call. Pass observedValue for a machine-resolvable criterion, or outcome to say what happened. An explicit outcome wins.",
  {
    forecastId: z.string(),
    observedValue: z.number().optional(),
    outcome: z.boolean().optional(),
    note: z.string().optional(),
  },
  "forecasts:settle",
);

tool(
  "void_forecast",
  "Void a forecast",
  "For a call whose criterion became unresolvable. Dropped from the record with a reason, never scored as a miss.",
  { forecastId: z.string(), reason: z.string() },
  "forecasts:voidForecast",
);

tool(
  "calibration",
  "Calibration and Brier score",
  "The track record: mean Brier, expected calibration error, and the reliability buckets behind them. 0.25 is the coin-flip line.",
  { windowDays: z.number().optional(), author: z.string().optional(), buckets: z.number().optional() },
  "forecasts:calibration",
);

// ── The deferred-decision queue ─────────────────────────────────────────

tool(
  "open_decision",
  "Open a deferred decision",
  "A conclusion with an expiry: what to revisit, and the condition that should trigger it. Anything you would otherwise phrase as 'wait and see' belongs here.",
  {
    key: z.string(),
    title: z.string(),
    triggerCondition: z.string(),
    detail: z.string().optional(),
    dueAt: z.number().optional().describe("epoch ms"),
  },
  "decisions:open",
);

tool(
  "close_decision",
  "Close a deferred decision",
  "Closing requires saying what happened, so an abandoned decision is distinguishable from a settled one.",
  { key: z.string(), outcome: z.string(), status: z.enum(["done", "void"]).optional() },
  "decisions:close",
);

tool(
  "list_decisions",
  "List deferred decisions",
  "The queue.",
  { status: z.enum(["open", "done", "void"]).optional() },
  "decisions:list",
);

tool(
  "overdue_decisions",
  "Overdue decisions",
  "Open decisions past their date: the ones that were going to be revisited and were not.",
  {},
  "decisions:overdue",
);

// ── Catalysts ───────────────────────────────────────────────────────────

tool(
  "add_catalyst",
  "Add a catalyst",
  "A dated forward event and the assets it touches. Lockups, index rebalances, unlocks and earnings are on a schedule, and the schedule is public.",
  {
    key: z.string(),
    title: z.string(),
    at: z.number().describe("epoch ms"),
    assets: z.array(z.string()),
    venue: z.string().optional(),
    source: z.string().optional(),
    note: z.string().optional(),
  },
  "catalysts:add",
);

tool(
  "upcoming_catalysts",
  "Upcoming catalysts",
  "Dated events inside a window, optionally filtered to one asset.",
  { windowDays: z.number().optional(), asset: z.string().optional() },
  "catalysts:upcoming",
);

// ── Audit ───────────────────────────────────────────────────────────────

tool(
  "audit_tail",
  "Audit log",
  "Append-only record of every state-changing mutation in this tenant, newest first.",
  { kind: z.string().optional(), limit: z.number().optional() },
  "audit:list",
);

const transport = new StdioServerTransport();
await server.connect(transport);
