#!/usr/bin/env node
// agent-worker: wakes an agent CLI when the book needs a judgement rather than
// a fetch.
//
// Two triggers, both of them things that otherwise rot quietly: a deferred
// decision whose trigger date has passed, and a due forecast whose criterion no
// parser can settle. The sync worker handles everything a machine can decide on
// its own; what is left is exactly the set that needs reading.
//
// The agent works through the MCP server, so the only way it can change
// anything is through the same tenant-scoped mutations a human uses. It has no
// order path, because there is none to have.
//
// Run: npx tsx agent-worker.mts

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  connectConvexWatcher,
  createConvexClient,
  loadEnvLocal,
  resolveConvexUrl,
  resolveServiceKey,
} from "@openportfolio/node";
import { ORDERS, runActor } from "./actor.mts";

const execFileP = promisify(execFile);
const PROJECT_ROOT = resolve(new URL(".", import.meta.url).pathname);

const CONVEX_TIMEOUT_MS = 30_000;
const CLI_MAX_BUFFER = 50 * 1024 * 1024;
const SPAWN_TIMEOUT_MS = 10 * 60_000;
const SWEEP_MS = 60 * 60_000;
// A due item stays due until someone deals with it, so an unguarded watcher
// would respawn an agent on every sweep for the same row. One run per hour per
// trigger set is enough to be useful and cheap enough to leave running.
const COOLDOWN_MS = 60 * 60_000;
const MAX_LISTED = 20;
const OUTPUT_EXCERPT = 2000;
const CONVEX_BIN = resolve(PROJECT_ROOT, "node_modules/.bin/convex");

for (const [key, val] of Object.entries(loadEnvLocal(PROJECT_ROOT))) {
  if (!process.env[key]) process.env[key] = val;
}

const SERVICE_KEY = resolveServiceKey();
const CONVEX_URL = resolveConvexUrl(PROJECT_ROOT);
const TENANT_SLUG = process.env.OPENPORTFOLIO_TENANT;

async function convexCli(fn: string, args: unknown): Promise<unknown> {
  const { stdout } = await execFileP(CONVEX_BIN, ["run", fn, JSON.stringify(args)], {
    cwd: PROJECT_ROOT,
    timeout: CONVEX_TIMEOUT_MS,
    maxBuffer: CLI_MAX_BUFFER,
  });
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

const transport = createConvexClient({
  url: CONVEX_URL,
  serviceKey: SERVICE_KEY,
  timeoutMs: CONVEX_TIMEOUT_MS,
  cliFallback: convexCli,
});

// The single boundary cast in this file.
async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const withTenant = TENANT_SLUG ? { tenantSlug: TENANT_SLUG, ...args } : args;
  return (await transport(fn, withTenant)) as T;
}

type Decision = { key: string; title: string; triggerCondition: string; dueAt?: number };
type DueForecast = { id: string; subject: string; resolutionCriterion: string; symbol: string | null };

function buildPrompt(decisions: Decision[], forecasts: DueForecast[]): string {
  const lines = [
    `You are the analyst on call for an openportfolio book.`,
    `Work through the openportfolio MCP tools. Read before you write: net_worth, list_balances,`,
    `list_flows and list_catalysts give you the position, the flow and the calendar.`,
    ``,
    `You are not a trading system. Never place an order, never recommend a quantity or a price,`,
    `and never imply that a holding should be bought or sold at a size. Your output is an`,
    `assessment and a probability, and the human decides what to do with it.`,
    ``,
  ];
  if (decisions.length > 0) {
    lines.push(`Deferred decisions whose trigger date has passed:`);
    for (const decision of decisions.slice(0, MAX_LISTED)) {
      lines.push(`- ${decision.key}: ${decision.title} (trigger: ${decision.triggerCondition})`);
    }
    lines.push(
      `For each: decide whether the trigger condition actually fired. If it did, close it with`,
      `close_decision and a one-line outcome. If it did not, leave it open and say why in a comment`,
      `on your final output.`,
      ``,
    );
  }
  if (forecasts.length > 0) {
    lines.push(`Forecasts past their horizon that no parser can settle:`);
    for (const forecast of forecasts.slice(0, MAX_LISTED)) {
      lines.push(`- ${forecast.id}: ${forecast.subject} (criterion: ${forecast.resolutionCriterion})`);
    }
    lines.push(
      `For each: establish whether the criterion was met, then call settle_forecast with an explicit`,
      `outcome. If the criterion became unresolvable, void_forecast with the reason instead. Do not`,
      `guess: an unresolvable call is voided, not scored.`,
      ``,
    );
  }
  lines.push(`Finish with a short plain-text summary of what you changed and what you left alone.`);
  return lines.join("\n");
}

let lastRunAt = 0;
let running = false;

async function drain(): Promise<void> {
  if (running) return;
  if (Date.now() - lastRunAt < COOLDOWN_MS) return;
  running = true;
  try {
    const decisions = await call<Decision[]>("decisions:overdue", {});
    const due = await call<DueForecast[]>("forecasts:listDue", {});
    const needsReading = due.filter((row) => row.symbol === null);
    if (decisions.length === 0 && needsReading.length === 0) return;

    lastRunAt = Date.now();
    console.log(
      `[${new Date().toISOString()}] dispatch: ${decisions.length} decisions, ${needsReading.length} forecasts`,
    );
    const { provider, stdout } = await runActor({
      order: ORDERS.review,
      prompt: buildPrompt(decisions, needsReading),
      cwd: PROJECT_ROOT,
      env: process.env,
      mode: "agent",
      timeoutMs: SPAWN_TIMEOUT_MS,
      onAttempt: (e) => {
        if (e.event === "fail") console.warn(`  x ${e.provider}: ${e.error}`);
      },
    });
    console.log(`  ${provider}: ${stdout.trim().slice(0, OUTPUT_EXCERPT) || "(no output)"}`);
  } catch (e) {
    console.error("agent run failed:", (e as Error).message);
  } finally {
    running = false;
  }
}

async function main(): Promise<void> {
  const watcher = await connectConvexWatcher({
    url: CONVEX_URL,
    serviceKey: SERVICE_KEY,
    onError: (fn, e) => console.error(`[watch] ${fn}: ${e.message}`),
  });
  const args = TENANT_SLUG ? { tenantSlug: TENANT_SLUG } : {};
  if (watcher.live) {
    watcher.watch("decisions:overdue", args, () => void drain());
    watcher.watch("forecasts:listDue", args, () => void drain());
  }
  setInterval(() => void drain(), SWEEP_MS);
  console.log(`agent-worker started, ${SWEEP_MS / 60_000}m sweep, watcher ${watcher.live ? "live" : "off"}`);
  await drain();
}

void main();
