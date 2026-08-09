import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Structurally what process.env is, without the ambient type: a partial object
// literal satisfies this, so callers do not need a cast.
type EnvLike = Record<string, string | undefined>;

// A hand-rolled `^KEY\s*=\s*(\S+)` regex disagrees with a real parser on a
// quoted value and on a commented line, and the two workers had drifted onto
// different regexes. One parser, used by everything that reads .env.local.
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1);
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      // Trailing `# comment` on an unquoted value only. Stripping it
      // unconditionally truncates a quoted value that legitimately contains
      // " #", which a generated service key can.
      const hash = value.indexOf(" #");
      if (hash > 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

export function loadEnvLocal(dir: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(resolve(dir, ".env.local"), "utf8"));
  } catch {
    return {};
  }
}

// CONVEX_URL wins; then .env.local; then derive it from the deployment name.
// `dir` is the repo root and not process.cwd(), because a worker launched from
// anywhere else would otherwise silently fall back to the CLI transport.
export function resolveConvexUrl(dir: string, env: EnvLike = process.env): string | null {
  if (env.CONVEX_URL) return env.CONVEX_URL;
  const fromFile = loadEnvLocal(dir).CONVEX_URL;
  if (fromFile) return fromFile;
  const match = env.CONVEX_DEPLOYMENT?.match(/^(?:dev|prod):(.+)$/);
  if (!match) return null;
  return `https://${match[1]}.convex.cloud`;
}

// A worker with no service key is not a worker in read-only mode. It works only
// against a deployment that has OPENPORTFOLIO_DEV_TENANT set, which is the
// localhost case; anywhere else the tenant gate rejects every call. Warn once
// at startup with the variable named rather than once per call, and do not
// throw, because the localhost case is a real one.
export function resolveServiceKey(
  env: EnvLike = process.env,
  warn: (message: string) => void = console.warn,
): string | undefined {
  const key = env.OPENPORTFOLIO_SERVICE_KEY;
  if (!key) {
    warn("OPENPORTFOLIO_SERVICE_KEY is not set: only a deployment with OPENPORTFOLIO_DEV_TENANT will accept calls");
  }
  return key;
}
