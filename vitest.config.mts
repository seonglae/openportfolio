import { defineConfig } from "vitest/config";

// One runner for the whole workspace (`pnpm test`), split into projects because
// the tiers need different environments: plain node for the shared packages and
// the CLI dispatch layer, Convex's edge runtime for backend handlers, and a DOM
// for React components. Tests live in `<module>/test` throughout.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "root",
          root: "./",
          include: ["test/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "packages",
          root: "./packages",
          include: ["*/test/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "convex",
          root: "./convex",
          // convex-test executes handlers in the same runtime Convex uses, so a
          // tenant-scoping bug shows up here exactly as it would in production.
          include: ["test/**/*.test.ts"],
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        test: {
          name: "browser",
          root: "./browser",
          include: ["test/**/*.test.{ts,tsx}"],
          environment: "happy-dom",
        },
      },
    ],
  },
});
