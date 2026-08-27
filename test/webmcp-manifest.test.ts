/**
 * The two transports must offer the same tools.
 *
 * `packages/domain/src/agent-tools.ts` is the list `browser/` imports for
 * WebMCP. `mcp/portfolio-server.mjs` holds the same list in Zod and cannot
 * import the first one: it runs under bare node, where a `.ts` specifier would
 * put a node-version floor on every tool, which is why it imports no workspace
 * package at all.
 *
 * So the guarantee is a test rather than an import. Adding a tool to the stdio
 * server and forgetting the manifest would silently give browser agents a
 * smaller book than CLI agents, and nothing else in the repo would notice.
 *
 * Names and Convex functions only. Schemas are Zod on one side and JSON Schema
 * on the other, and translating between them inside a test is more machinery
 * than the guarantee is worth: a schema that disagrees weakens an argument
 * hint, while a tool that disagrees is a capability one client does not have.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { AGENT_TOOLS, readOnlyAgentTools } from "../packages/domain/src/agent-tools.ts";

const SERVER = resolve(import.meta.dirname, "../mcp/portfolio-server.mjs");

/**
 * Every `tool(...)` call in the server, as (name, convexFn).
 *
 * Parsed by balancing parentheses rather than by one regex: the calls span
 * lines, several arguments contain their own parentheses and commas inside Zod
 * chains, and a naive match silently returns a short list, which would make
 * this test pass while checking almost nothing.
 */
function serverTools(): Array<{ name: string; fn: string }> {
  const src = readFileSync(SERVER, "utf8");
  const out: Array<{ name: string; fn: string }> = [];
  const call = /\btool\(/g;
  let m = call.exec(src);
  while (m !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    let inString = false;
    let escaped = false;
    const start = i;
    while (depth > 0 && i < src.length) {
      const ch = src[i];
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = !inString;
      } else if (!inString) {
        if (ch === "(") depth += 1;
        else if (ch === ")") depth -= 1;
      }
      i += 1;
    }
    const body = src.slice(start, i - 1);
    const name = /^\s*"([a-z_]+)"/.exec(body);
    // The Convex function is the last string argument, and it is the only one
    // shaped `module:function`.
    const fns = [...body.matchAll(/"([A-Za-z]+:[A-Za-z]+)"/g)];
    if (name !== null && fns.length > 0) {
      const last = fns[fns.length - 1];
      out.push({ name: name[1], fn: last[1] });
    }
    m = call.exec(src);
  }
  return out;
}

describe("the manifest and the stdio server describe the same book", () => {
  it("finds the server's tools at all", () => {
    // Guards the parser itself. If a refactor changes how tools are declared,
    // this fails loudly instead of the suite quietly comparing empty lists.
    expect(serverTools().length).toBeGreaterThanOrEqual(20);
  });

  it("has no tool on one side that is missing from the other", () => {
    const onServer = new Set(serverTools().map((t) => t.name));
    const onManifest = new Set(AGENT_TOOLS.map((t) => t.name));
    expect([...onServer].filter((n) => !onManifest.has(n))).toEqual([]);
    expect([...onManifest].filter((n) => !onServer.has(n))).toEqual([]);
  });

  it("points each tool at the same Convex function", () => {
    // The failure this catches: record_forecast calls forecasts:emit, not the
    // forecasts:record its name suggests. A manifest written from tool names
    // rather than from the source gets that wrong and only fails at runtime.
    const server = new Map(serverTools().map((t) => [t.name, t.fn]));
    for (const tool of AGENT_TOOLS) {
      expect(`${tool.name} -> ${server.get(tool.name)}`).toBe(`${tool.name} -> ${tool.fn}`);
    }
  });
});

describe("readOnly is set from what the function actually does", () => {
  it("marks every tool that writes", () => {
    // Hand-checked against the Convex handlers. Listed positively so that a new
    // write tool defaulting to readOnly: true fails here rather than being
    // handed to an agent on the public demo page.
    const writes = [
      "snapshot_net_worth",
      "link_account",
      "record_flow",
      "record_forecast",
      "settle_forecast",
      "void_forecast",
      "open_decision",
      "close_decision",
      "add_catalyst",
    ];
    const marked = AGENT_TOOLS.filter((t) => !t.readOnly).map((t) => t.name);
    expect(marked.sort()).toEqual([...writes].sort());
  });

  it("keeps every read tool out of that set", () => {
    expect(readOnlyAgentTools().length).toBe(AGENT_TOOLS.length - 9);
    for (const tool of readOnlyAgentTools()) {
      expect(tool.readOnly).toBe(true);
    }
  });
});

describe("schemas are well formed", () => {
  it("declares every required field as a property", () => {
    // A required name that is not in properties is a schema an agent cannot
    // satisfy: it is told the argument is mandatory and never told its type.
    for (const tool of AGENT_TOOLS) {
      for (const key of tool.inputSchema.required ?? []) {
        expect(`${tool.name}.${key}`).toBe(
          key in tool.inputSchema.properties ? `${tool.name}.${key}` : `${tool.name}.MISSING:${key}`,
        );
      }
    }
  });

  it("gives every enum property at least two choices", () => {
    for (const tool of AGENT_TOOLS) {
      for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
        if (prop.enum === undefined) continue;
        expect(`${tool.name}.${key}=${prop.enum.length}`).toBe(`${tool.name}.${key}=${prop.enum.length}`);
        expect(prop.enum.length).toBeGreaterThan(1);
      }
    }
  });
});
