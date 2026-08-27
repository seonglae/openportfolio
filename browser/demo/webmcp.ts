/**
 * The demo book, exposed to a browser agent through WebMCP.
 *
 * Trying openportfolio with an agent means cloning, installing, and wiring a
 * stdio server into a client config. This is the zero-install version of the
 * same thing: open the demo in a browser that has the API and the agent can
 * ask the book questions directly. The numbers are invented, so there is
 * nothing here that a visitor could leak.
 *
 * Read-only tools only. `AGENT_TOOLS` carries nine that write, and a page on
 * the open internet must not hand an agent a path into a table, even a fixture
 * one. The demo also has no backend at all: `demo/convex-react.ts` swaps the
 * Convex client for a fixture lookup, so a write would have nowhere to land.
 *
 * Registration is per tool. The spec also grew a `provideContext()` that sets
 * every tool at once, but the sources disagree about whether it survived the
 * March 2026 revision, and `registerTool`/`unregisterTool` are in both. Using
 * only the pair that both describe is the part that will still compile when
 * the draft moves.
 *
 * Demo-only. Nothing in the shipped app imports this: the real dashboard needs
 * a Convex call per tool and a decision about the nine writes, which is a
 * separate change.
 */
import { readOnlyAgentTools, type AgentTool } from "@openportfolio/domain";

import { FIXTURES } from "./fixtures.ts";

/**
 * A tool as `navigator.modelContext` takes it. Declared here rather than
 * imported: the API is a W3C draft with no published typings, and inventing a
 * dependency on one would age worse than eight lines.
 */
type ModelContextTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: unknown) => Promise<Record<string, unknown>>;
};

type ModelContextApi = {
  registerTool: (tool: ModelContextTool) => void;
  unregisterTool: (name: string) => void;
};

function modelContext(): ModelContextApi | null {
  if (!("modelContext" in navigator)) return null;
  // The transport boundary for this file: `navigator` is typed without the
  // draft API, and feature detection above is what makes the cast safe.
  const api = (navigator as Navigator & { modelContext: ModelContextApi }).modelContext;
  if (typeof api.registerTool !== "function") return null;
  return api;
}

/**
 * A tool the fixture table cannot answer must not be registered. Registering
 * it anyway would advertise a capability and then return nothing, which reads
 * to an agent as a broken book rather than a demo with a gap. Four read tools
 * have no fixture today (symbol_exposure, list_venues, due_forecasts,
 * audit_tail); adding one to `fixtures.ts` is all it takes for the tool to
 * appear here, with no edit to this file.
 */
function servable(tool: AgentTool): boolean {
  return tool.fn in FIXTURES;
}

function describe(tool: AgentTool): ModelContextTool {
  return {
    name: tool.name,
    description: `${tool.description} (Demo book: every figure is invented.)`,
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: true },
    execute: async () => {
      const data = FIXTURES[tool.fn];
      // Always an object, never the bare fixture. Half of these are arrays and
      // the handler contract is a plain object, so one wrapper shape means an
      // agent reads every answer the same way.
      return { fn: tool.fn, data };
    },
  };
}

/** Set by install(), so a second call is a no-op rather than an InvalidStateError. */
let installed: string[] = [];

/**
 * Register the demo tools. Returns a teardown that unregisters them.
 *
 * Called from `demo/main.tsx` before render rather than from an effect: the
 * tools belong to the page, not to a component, and StrictMode double-invokes
 * effects, which would either throw on the duplicate name or leave the tools
 * unregistered after the second cleanup.
 */
export function installDemoTools(): () => void {
  const api = modelContext();
  if (api === null) return () => {};
  if (installed.length > 0) return uninstallDemoTools;

  const names: string[] = [];
  for (const tool of readOnlyAgentTools()) {
    if (!servable(tool)) continue;
    try {
      api.registerTool(describe(tool));
      names.push(tool.name);
    } catch (e) {
      // One bad tool must not cost the other eleven. A duplicate name or a
      // schema the browser rejects throws InvalidStateError; the rest are
      // still worth having.
      console.warn(`[demo] webmcp could not register ${tool.name}`, e);
    }
  }
  installed = names;
  return uninstallDemoTools;
}

export function uninstallDemoTools(): void {
  const api = modelContext();
  if (api === null) return;
  for (const name of installed) {
    try {
      api.unregisterTool(name);
    } catch (e) {
      console.warn(`[demo] webmcp could not unregister ${name}`, e);
    }
  }
  installed = [];
}

/** The names this page would register. Exported for the test. */
export function demoToolNames(): string[] {
  return readOnlyAgentTools()
    .filter(servable)
    .map((t) => t.name);
}
