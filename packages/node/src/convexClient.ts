// The Convex HTTP API needs to know whether a function is a query, a mutation
// or an action, but a caller only has its path. So: try the kind that worked
// last time, and on a "defined as X" error walk the other two. Anything else is
// a real function error and is raised as one.

export type ConvexResult = { status: string; value?: unknown; errorMessage?: string };

export type ConvexClientOptions = {
  // null when no deployment URL could be resolved, which sends every call
  // through cliFallback instead.
  url: string | null;
  // Presented on every call. The tenant gate maps one key to exactly one
  // tenant, so this is also what decides which tenant a headless worker is.
  serviceKey?: string;
  timeoutMs: number;
  cliFallback: (fn: string, args: unknown) => Promise<unknown>;
  // Shared with a caller's other transport so one path's discovery primes the
  // other's, saving a probe request per function.
  kindCache?: Map<string, string>;
  fetchImpl?: typeof fetch;
};

const KINDS = ["query", "mutation", "action"];

// The server says this when the path exists but was called on the wrong
// endpoint. It is the only error that means "try another kind".
const WRONG_KIND = /defined as (Query|Mutation|Action)/i;

export function createConvexClient(opts: ConvexClientOptions) {
  const kindOf = opts.kindCache ?? new Map<string, string>();
  const doFetch = opts.fetchImpl ?? fetch;

  return async function convex(fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
    // Workers reach the anonymous HTTP API, never a browser session, so the
    // service key is the whole of their identity. An explicit key on the call
    // wins, which is how a multi-tenant worker addresses a second tenant.
    let withKey = args;
    if (opts.serviceKey && args.serviceKey == null) withKey = { ...args, serviceKey: opts.serviceKey };

    if (!opts.url) return await opts.cliFallback(fn, withKey);

    const first = kindOf.get(fn) ?? "query";
    const rest = KINDS.filter((k) => k !== first);
    let lastError = "";
    for (const kind of [first, ...rest]) {
      const res = await doFetch(`${opts.url}/api/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fn, args: withKey, format: "json" }),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      const body = (await res.json()) as ConvexResult;
      if (body.status === "success") {
        kindOf.set(fn, kind);
        return body.value ?? null;
      }
      lastError = body.errorMessage ?? "unknown convex error";
      if (!WRONG_KIND.test(lastError)) throw new Error(`${fn}: ${lastError}`);
    }
    throw new Error(`${fn}: ${lastError}`);
  };
}
