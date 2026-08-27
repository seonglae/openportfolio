/**
 * The demo's WebMCP surface.
 *
 * Two things matter here and neither is visible by opening the page. The first
 * is that no write tool is ever registered: this runs on the open internet, and
 * a regression that let one through would not show up until an agent called it.
 * The second is that a browser without the API gets a no-op rather than a
 * thrown error, because Chrome 146 and Edge 147 are the only engines that have
 * it and every other visitor still has to see a working demo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { AGENT_TOOLS } from "@openportfolio/domain";

import { FIXTURES } from "../demo/fixtures.ts";
import { demoToolNames, installDemoTools, uninstallDemoTools } from "../demo/webmcp.ts";

type Registered = {
  name: string;
  description: string;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: unknown) => Promise<Record<string, unknown>>;
};

function fakeApi() {
  const tools = new Map<string, Registered>();
  const api = {
    registerTool: vi.fn((tool: Registered) => {
      if (tools.has(tool.name)) throw new Error("InvalidStateError");
      tools.set(tool.name, tool);
    }),
    unregisterTool: vi.fn((name: string) => {
      if (!tools.has(name)) throw new Error("InvalidStateError");
      tools.delete(name);
    }),
  };
  Object.defineProperty(navigator, "modelContext", { value: api, configurable: true });
  return { api, tools };
}

function removeApi() {
  if ("modelContext" in navigator) {
    Reflect.deleteProperty(navigator, "modelContext");
  }
}

afterEach(() => {
  uninstallDemoTools();
  removeApi();
  vi.restoreAllMocks();
});

describe("what gets registered", () => {
  it("registers only tools that cannot write", () => {
    const { tools } = fakeApi();
    installDemoTools();
    const writes = new Set(AGENT_TOOLS.filter((t) => !t.readOnly).map((t) => t.name));
    for (const name of tools.keys()) {
      expect(`${name} is a write tool: ${writes.has(name)}`).toBe(`${name} is a write tool: false`);
    }
    expect(tools.size).toBeGreaterThan(0);
  });

  it("skips a read tool the fixture table cannot answer", () => {
    // Registering it would advertise a capability and then return nothing,
    // which reads as a broken book rather than a demo with a gap.
    const { tools } = fakeApi();
    installDemoTools();
    for (const name of tools.keys()) {
      const tool = AGENT_TOOLS.find((t) => t.name === name);
      expect(tool !== undefined && tool.fn in FIXTURES).toBe(true);
    }
  });

  it("registers every read tool that does have a fixture", () => {
    const { tools } = fakeApi();
    installDemoTools();
    expect([...tools.keys()].sort()).toEqual(demoToolNames().sort());
  });

  it("marks each one read-only for the agent", () => {
    const { tools } = fakeApi();
    installDemoTools();
    for (const tool of tools.values()) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("says the numbers are invented in every description", () => {
    // The page carries a banner, but an agent reads the tool list, not the
    // page, and could otherwise report the demo book as someone's real one.
    const { tools } = fakeApi();
    installDemoTools();
    for (const tool of tools.values()) {
      expect(tool.description).toContain("invented");
    }
  });
});

describe("calling a tool", () => {
  it("returns the fixture under a stable shape", async () => {
    const { tools } = fakeApi();
    installDemoTools();
    const net = tools.get("net_worth");
    expect(net).toBeDefined();
    if (net === undefined) return;
    const out = await net.execute({});
    expect(out.fn).toBe("netWorth:current");
    expect(out.data).toBe(FIXTURES["netWorth:current"]);
  });

  it("wraps an array fixture rather than returning it bare", async () => {
    // The handler contract is a plain object, and half these fixtures are
    // arrays, so the wrapper is what keeps every answer readable the same way.
    const { tools } = fakeApi();
    installDemoTools();
    const accounts = tools.get("list_accounts");
    expect(accounts).toBeDefined();
    if (accounts === undefined) return;
    const out = await accounts.execute({});
    expect(Array.isArray(out)).toBe(false);
    expect(Array.isArray(out.data)).toBe(true);
  });
});

describe("browsers without the API", () => {
  it("installs nothing and does not throw", () => {
    removeApi();
    expect(() => installDemoTools()).not.toThrow();
  });

  it("tears down without throwing either", () => {
    removeApi();
    expect(() => uninstallDemoTools()).not.toThrow();
  });

  it("ignores an object that is not the real API", () => {
    // A polyfill or an extension could put something else on navigator.
    Object.defineProperty(navigator, "modelContext", { value: {}, configurable: true });
    expect(() => installDemoTools()).not.toThrow();
  });
});

describe("installing twice", () => {
  it("does not re-register, because a duplicate name throws", () => {
    const { api, tools } = fakeApi();
    installDemoTools();
    const afterFirst = tools.size;
    installDemoTools();
    expect(tools.size).toBe(afterFirst);
    expect(api.registerTool).toHaveBeenCalledTimes(afterFirst);
  });

  it("unregisters everything it registered", () => {
    const { tools } = fakeApi();
    installDemoTools();
    expect(tools.size).toBeGreaterThan(0);
    uninstallDemoTools();
    expect(tools.size).toBe(0);
  });

  it("can install again after a teardown", () => {
    const { tools } = fakeApi();
    installDemoTools();
    const first = tools.size;
    uninstallDemoTools();
    installDemoTools();
    expect(tools.size).toBe(first);
  });
});
