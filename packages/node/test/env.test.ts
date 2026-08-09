import { describe, expect, it } from "vitest";
import { parseEnvFile, resolveConvexUrl, resolveServiceKey } from "../src/env.ts";

describe("parsing .env.local", () => {
  it("keeps a quoted value whole, including a hash inside it", () => {
    const parsed = parseEnvFile('OPENPORTFOLIO_SERVICE_KEY="abc #def"');
    expect(parsed.OPENPORTFOLIO_SERVICE_KEY).toBe("abc #def");
  });

  it("strips a trailing comment only from an unquoted value", () => {
    expect(parseEnvFile("A=1 # the first one").A).toBe("1");
  });

  it("skips comments and blank lines", () => {
    expect(parseEnvFile("# note\n\nA=1\n")).toEqual({ A: "1" });
  });

  it("keeps an = inside a value", () => {
    expect(parseEnvFile("A=b=c").A).toBe("b=c");
  });
});

describe("resolving the deployment URL", () => {
  it("prefers an explicit CONVEX_URL", () => {
    expect(resolveConvexUrl("/nowhere", { CONVEX_URL: "https://x.convex.cloud" })).toBe("https://x.convex.cloud");
  });

  it("derives the URL from a deployment name", () => {
    expect(resolveConvexUrl("/nowhere", { CONVEX_DEPLOYMENT: "dev:happy-otter-42" })).toBe(
      "https://happy-otter-42.convex.cloud",
    );
  });

  // Falling back to the CLI transport is correct here; guessing a URL is not.
  it("reports null when nothing names a deployment", () => {
    expect(resolveConvexUrl("/nowhere", {})).toBeNull();
    expect(resolveConvexUrl("/nowhere", { CONVEX_DEPLOYMENT: "happy-otter-42" })).toBeNull();
  });
});

describe("the service key", () => {
  // A worker without one is not read-only, it is rejected on every call unless
  // the deployment has a dev tenant. Say so once, with the variable named.
  it("warns once when unset rather than failing per call", () => {
    const warnings: string[] = [];
    expect(resolveServiceKey({}, (m) => warnings.push(m))).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("OPENPORTFOLIO_SERVICE_KEY");
  });

  it("says nothing when one is set", () => {
    const warnings: string[] = [];
    expect(resolveServiceKey({ OPENPORTFOLIO_SERVICE_KEY: "k" }, (m) => warnings.push(m))).toBe("k");
    expect(warnings).toEqual([]);
  });
});
