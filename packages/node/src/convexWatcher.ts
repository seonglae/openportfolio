// Discovery over a websocket instead of a timer.
//
// A worker that finds its work by asking on an interval pays the same whether
// or not there is anything to do, and almost all of it is a query returning an
// empty list. Convex re-runs a subscribed query only when its result actually
// changes, so the same discovery costs one execution at startup and then
// nothing until real work appears.
//
// This wrapper deliberately does NOT claim anything. Callers keep their own
// claim mutation, which is what stops two machines taking the same item and is
// unaffected by how they learned the item existed.

import { makeFunctionReference } from "convex/server";

// The slice of ConvexClient used here. Naming it keeps the tests off a real
// websocket and states exactly what the wrapper depends on.
export type WatchClient = {
  onUpdate(
    query: unknown,
    args: Record<string, unknown>,
    callback: (value: unknown) => unknown,
    onError?: (e: Error) => unknown,
  ): () => void;
  close(): Promise<void>;
};

export type ConvexWatcherOptions = {
  // null when no deployment URL could be resolved. Subscriptions need a socket,
  // so `live` goes false and the caller keeps its interval.
  url: string | null;
  serviceKey?: string;
  // A failing subscription must not take the process down: onUpdate throws into
  // the socket's message handler when no error callback is supplied, which the
  // caller cannot recover from.
  onError?: (fn: string, error: Error) => void;
  clientImpl?: WatchClient;
};

export type ConvexWatcher = {
  readonly live: boolean;
  // Runs `onChange` with the query's result: once on subscribe, and then only
  // when the result changes. Returns an unsubscribe function.
  watch(fn: string, args: Record<string, unknown>, onChange: (value: unknown) => void): () => void;
  close(): Promise<void>;
};

export function createConvexWatcher(opts: ConvexWatcherOptions): ConvexWatcher {
  const client = opts.clientImpl ?? null;
  if (!opts.url && !client) {
    return { live: false, watch: () => () => {}, close: async () => {} };
  }

  let impl: WatchClient | null = client;
  const clientOf = (): WatchClient => {
    if (!impl) throw new Error("convex watcher has no client");
    return impl;
  };

  return {
    live: true,
    watch(fn, args, onChange) {
      // Same rule as the HTTP transport: an anonymous socket carries no
      // identity, so the service key is what resolves the tenant.
      let withKey = args;
      if (opts.serviceKey && args.serviceKey == null) withKey = { ...args, serviceKey: opts.serviceKey };
      return clientOf().onUpdate(makeFunctionReference<"query">(fn), withKey, onChange, (e) => opts.onError?.(fn, e));
    },
    async close() {
      if (impl) await impl.close();
      impl = null;
    },
  };
}

// Kept separate from createConvexWatcher so the wrapper stays testable without
// a websocket: this is the only place that constructs the real client.
export async function connectConvexWatcher(opts: Omit<ConvexWatcherOptions, "clientImpl">): Promise<ConvexWatcher> {
  if (!opts.url) return createConvexWatcher(opts);
  const { ConvexClient } = await import("convex/browser");
  const client = new ConvexClient(opts.url) as unknown as WatchClient;
  return createConvexWatcher({ ...opts, clientImpl: client });
}
