// Stands in for `convex/react` in the demo build, via an alias in
// vite.demo.config.ts. The views are untouched: they still call
// `useQuery(api.netWorth.current, {})`, and the function reference carries its
// own name, so the fixture table can be keyed by it.
//
// This module is demo-only. Nothing in the shipped app imports it.
import { getFunctionName } from "convex/server";

import { FIXTURES } from "./fixtures.ts";

export function useQuery(reference: unknown, _args?: unknown): unknown {
  let name: string;
  try {
    name = getFunctionName(reference as Parameters<typeof getFunctionName>[0]);
  } catch {
    return undefined;
  }
  if (!(name in FIXTURES)) {
    // Returning undefined here would render as a permanent "loading", which
    // looks like a bug in the app rather than a gap in the fixtures.
    console.warn(`[demo] no fixture for ${name}`);
    return undefined;
  }
  return FIXTURES[name];
}
