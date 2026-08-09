// actor.mts: the single entry point for spawning agent CLIs. Every worker
// routes through here so the fallback chain, the argv layout, the stdin / -p
// semantics and the MCP wiring are defined exactly once.
//
// There is no provider API key in this repo, and there is no place to put one.
// A model call is a spawn of a CLI the operator is already signed in to, which
// is what makes an autonomous run cost quota and wall clock rather than money.
// A product that spends the operator's money unprompted has to ask first, or
// batch, or ration; all three would turn a portfolio that watches itself into a
// portfolio that asks permission to look.
//
// Two surfaces:
//   spawnProvider(name, opts)  low-level: returns the child process. Callers
//                              wire stdout / stderr / timeouts themselves.
//   runActor({ order, ... })   high-level: walks the fallback chain
//                              sequentially and resolves with the first
//                              success.

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const SIGKILL_GRACE_MS = 5_000;
const STDERR_EXCERPT = 500;

// Absolute path to this repo's MCP server, exposed INLINE to every spawned
// agent so it can read and write the graph without depending on each CLI's
// global MCP registration. The server reads OPENPORTFOLIO_SERVICE_KEY and
// CONVEX_DEPLOYMENT from the inherited environment, so no secret is ever placed
// on the argv, where it would show up in `ps`.
const MCP_PATH = resolve(new URL(".", import.meta.url).pathname, "mcp/portfolio-server.mjs");

const inlineMcpJSON = JSON.stringify({
  mcpServers: { openportfolio: { command: "node", args: [MCP_PATH] } },
});

const codexMcpArgs = [
  "-c",
  'mcp_servers.openportfolio.command="node"',
  "-c",
  `mcp_servers.openportfolio.args=["${MCP_PATH}"]`,
];

export type ProviderName = "antigravity" | "codex" | "claude";

// "job"   = a scheduled run (reconcile, flow sweep, review)
// "chat"  = a follow-up reply to a human
// "agent" = a triggered run, invoked as `-p PROMPT` with the MCP attached
export type Mode = "job" | "chat" | "agent";

export type SpawnOpts = {
  prompt: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  mode?: Mode;
  skipMcp?: boolean;
  mcpConfig?: string;
};

export type RunResult = { stdout: string; stderr: string; code: number };
export type ActorResult = RunResult & { provider: ProviderName };

export type AttemptEvent =
  | { event: "attempt"; provider: ProviderName }
  | { event: "success"; provider: ProviderName; code: number }
  | { event: "fail"; provider: ProviderName; error: string };

export type RunActorOpts = SpawnOpts & {
  order: ProviderName[];
  timeoutMs?: number;
  onAttempt?: (e: AttemptEvent) => void;
};

// Per-task-type fallback chains. The chain exists mostly because a subscription
// plan runs out: one provider hits its limit hours before the others do, and a
// portfolio that stops reconciling at 4pm is not a portfolio that reconciles.
//
// codex leads everywhere except `review`, which is the long-context read of the
// whole book and the one task where claude's handling of a large working set
// showed. (antigravity is `agy`, the Gemini-powered CLI.)
export const ORDERS: Record<string, ProviderName[]> = {
  reconcile: ["codex", "antigravity", "claude"],
  flow: ["codex", "antigravity", "claude"],
  forecast: ["codex", "antigravity", "claude"],
  review: ["claude", "codex", "antigravity"],
  chat: ["codex", "antigravity", "claude"],
  agentRun: ["codex", "antigravity", "claude"],
  default: ["codex", "antigravity", "claude"],
};

export function orderFor(taskType?: string): ProviderName[] {
  if (taskType && ORDERS[taskType]) return ORDERS[taskType];
  return ORDERS.default;
}

export function nextProvider(name: ProviderName, order: ProviderName[]): ProviderName | null {
  const i = order.indexOf(name);
  if (i < 0 || i + 1 >= order.length) return null;
  return order[i + 1];
}

// How one provider is invoked. Split out of spawnProvider so the argv can be
// asserted without launching a CLI: these flags decide whether an agent can
// reach the network or the backend at all, and getting one wrong fails the run
// in a way that looks like the model misbehaving rather than a config bug.
export type Invocation = { cmd: string; args: string[]; useStdin: boolean };

export function providerInvocation(provider: ProviderName, opts: Omit<SpawnOpts, "cwd" | "env">): Invocation {
  const { prompt, mode = "job", skipMcp, mcpConfig } = opts;
  if (provider === "antigravity") {
    // `--print` runs one prompt non-interactively; `--dangerously-skip-permissions`
    // auto-approves tool calls, which a scheduled run has nobody to ask.
    return { cmd: "agy", args: ["--print", prompt, "--dangerously-skip-permissions"], useStdin: false };
  }
  if (provider === "codex") {
    // codex exec sandboxes to workspace-write, and workspace-write denies
    // network by default. Every prompt this repo builds ends by writing its
    // result back through the MCP server or `convex run`, and quotes have to be
    // fetched first, so without this codex could not finish a single task: DNS
    // fails, nothing reaches the backend, and the chain falls through to the
    // next provider on every job. The other two run unsandboxed already, so
    // this closes an asymmetry rather than widening the blast radius.
    const network = ["-c", "sandbox_workspace_write.network_access=true"];
    const mcp = skipMcp ? [] : codexMcpArgs;
    return { cmd: "codex", args: ["exec", ...network, ...mcp], useStdin: true };
  }
  if (provider === "claude") {
    if (mode === "agent") {
      const args = ["-p", prompt, "--dangerously-skip-permissions"];
      if (!skipMcp) args.push("--mcp-config", inlineMcpJSON);
      return { cmd: "claude", args, useStdin: false };
    }
    const args = ["-p", "--no-session-persistence", "--dangerously-skip-permissions"];
    // JSON output for job and chat alike. Plain text leaks CLI diagnostic
    // banners into stdout, and those end up concatenated onto whatever the
    // caller treats as the reply.
    args.push("--output-format", "json");
    if (!skipMcp) {
      args.push("--mcp-config", inlineMcpJSON);
      // --mcp-config accepts multiple values and merges them, so a caller's
      // extra server (a headless browser, say) layers on for scheduled jobs.
      if (mode === "job" && mcpConfig) args.push("--mcp-config", mcpConfig);
    }
    return { cmd: "claude", args, useStdin: true };
  }
  throw new Error(`unknown provider: ${provider}`);
}

// Spawn one provider. Returns the child directly so the caller can attach
// handlers, track it, and signal it on demand.
export function spawnProvider(provider: ProviderName, opts: SpawnOpts): ChildProcess {
  const { prompt, cwd, env } = opts;
  const { cmd, args, useStdin } = providerInvocation(provider, opts);
  const child = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env });
  const stdin = child.stdin;
  if (stdin) {
    if (useStdin) stdin.write(prompt);
    // Closed either way: a CLI reading stdin waits forever on an open pipe.
    stdin.end();
  }
  return child;
}

// Walks the chain in order and resolves with the first success. Rejects only
// when every provider has failed, carrying the last error.
export async function runActor(opts: RunActorOpts): Promise<ActorResult> {
  const { order, timeoutMs = DEFAULT_TIMEOUT_MS, onAttempt, ...spawnOpts } = opts;
  let lastErr: Error | undefined;
  for (const provider of order) {
    onAttempt?.({ event: "attempt", provider });
    try {
      const result = await runOne(provider, { ...spawnOpts, timeoutMs });
      onAttempt?.({ event: "success", provider, code: result.code });
      return { provider, ...result };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      onAttempt?.({ event: "fail", provider, error: lastErr.message });
    }
  }
  throw lastErr ?? new Error("all providers failed");
}

function runOne(provider: ProviderName, opts: SpawnOpts & { timeoutMs: number }): Promise<RunResult> {
  return new Promise<RunResult>((resolvePromise, reject) => {
    const child = spawnProvider(provider, opts);
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), SIGKILL_GRACE_MS);
      reject(new Error(`${provider}: timeout after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code === 0) resolvePromise({ stdout, stderr, code });
      else reject(new Error(`${provider}: exit ${code}\n${stderr.slice(0, STDERR_EXCERPT)}`));
    });
  });
}
