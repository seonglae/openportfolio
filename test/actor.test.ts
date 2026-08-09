import { describe, expect, it } from "vitest";
import { ORDERS, nextProvider, orderFor, providerInvocation, runActor } from "../actor.mts";

// These flags are the difference between an agent that can do the work and one
// that silently cannot. A wrong flag does not crash: the CLI exits 0 having
// achieved nothing, the run reports success, and nothing was written. So the
// argv is pinned here.
const inv = (provider: Parameters<typeof providerInvocation>[0], opts = {}) =>
  providerInvocation(provider, { prompt: "p", ...opts });

describe("codex invocation", () => {
  // The bug this pins: codex exec sandboxes to workspace-write, which denies
  // network, and every task this repo builds ends by writing its result back
  // over the network.
  it("enables network access, because every task writes its result over the wire", () => {
    expect(inv("codex").args).toContain("sandbox_workspace_write.network_access=true");
  });

  it("keeps network access in chat and agent mode too", () => {
    for (const mode of ["chat", "agent"] as const) {
      expect(inv("codex", { mode }).args).toContain("sandbox_workspace_write.network_access=true");
    }
  });

  it("runs exec and takes its prompt on stdin", () => {
    const { cmd, args, useStdin } = inv("codex");
    expect(cmd).toBe("codex");
    expect(args[0]).toBe("exec");
    expect(useStdin).toBe(true);
  });

  it("attaches the openportfolio MCP unless the caller skips it", () => {
    expect(inv("codex").args.join(" ")).toContain("mcp_servers.openportfolio.command");
    expect(inv("codex", { skipMcp: true }).args.join(" ")).not.toContain("mcp_servers.openportfolio.command");
  });
});

describe("the other providers in the chain", () => {
  it("antigravity takes the prompt as an argument and skips permissions", () => {
    const { cmd, args, useStdin } = inv("antigravity");
    expect(cmd).toBe("agy");
    expect(args).toEqual(["--print", "p", "--dangerously-skip-permissions"]);
    expect(useStdin).toBe(false);
  });

  it("claude asks for JSON so CLI banners stay out of the result text", () => {
    expect(inv("claude", { mode: "job" }).args).toContain("--output-format");
    expect(inv("claude", { mode: "chat" }).args).toContain("--output-format");
  });

  it("claude in agent mode inlines the prompt rather than reading stdin", () => {
    const { args, useStdin } = inv("claude", { mode: "agent" });
    expect(args.slice(0, 2)).toEqual(["-p", "p"]);
    expect(useStdin).toBe(false);
  });

  it("layers a caller's extra MCP config onto a scheduled job only", () => {
    expect(inv("claude", { mode: "job", mcpConfig: "/tmp/x.json" }).args).toContain("/tmp/x.json");
    expect(inv("claude", { mode: "chat", mcpConfig: "/tmp/x.json" }).args).not.toContain("/tmp/x.json");
  });

  it("rejects a provider it does not know", () => {
    expect(() => inv("gemini" as never)).toThrow("unknown provider");
  });
});

// No provider key appears anywhere: the whole point is that the operator is
// already signed in to these CLIs.
describe("no API key anywhere in the invocation", () => {
  it("passes no key, token or secret on the argv", () => {
    for (const provider of ["antigravity", "codex", "claude"] as const) {
      const argv = inv(provider).args.join(" ").toLowerCase();
      expect(argv).not.toMatch(/api[-_]?key|bearer|secret|token=/);
    }
  });
});

describe("fallback order", () => {
  it("gives every task type a chain of all three providers", () => {
    for (const order of Object.values(ORDERS)) {
      expect([...new Set(order)]).toHaveLength(3);
    }
  });

  // Reading the whole book is the one task where the long-context provider goes
  // first; everywhere else codex leads.
  it("leads review with claude and everything else with codex", () => {
    expect(ORDERS.review[0]).toBe("claude");
    for (const [task, order] of Object.entries(ORDERS)) {
      if (task === "review") continue;
      expect(order[0]).toBe("codex");
    }
  });

  it("falls back to the default order for an unknown task type", () => {
    expect(orderFor("no-such-task")).toEqual(ORDERS.default);
    expect(orderFor(undefined)).toEqual(ORDERS.default);
  });

  it("reports no next provider once the chain is exhausted", () => {
    const order = ORDERS.default;
    expect(nextProvider(order[0], order)).toBe(order[1]);
    expect(nextProvider(order[order.length - 1], order)).toBeNull();
  });
});

// The chain is only worth having if a dead provider costs one attempt and not
// the run. These spawn real binaries that do not exist, which is exactly the
// failure a signed-out or uninstalled CLI produces.
describe("walking the chain", () => {
  it("tries every provider in order before giving up", async () => {
    const attempted: string[] = [];
    await expect(
      runActor({
        order: ["antigravity", "codex", "claude"],
        prompt: "p",
        timeoutMs: 5_000,
        env: { PATH: "/nonexistent" },
        onAttempt: (e) => {
          if (e.event === "attempt") attempted.push(e.provider);
        },
      }),
    ).rejects.toThrow();
    expect(attempted).toEqual(["antigravity", "codex", "claude"]);
  });

  it("reports the last provider's failure rather than a generic one", async () => {
    await expect(
      runActor({ order: ["codex"], prompt: "p", timeoutMs: 5_000, env: { PATH: "/nonexistent" } }),
    ).rejects.toThrow(/ENOENT|codex/);
  });
});
