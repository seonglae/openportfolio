# Working in this repo

Notes for contributors, and for agent CLIs operating here. What the product is
arguing is in `README.md`; this file is about the code.

## Two invariants

Everything else in this file is a convention. These two are not.

### 1. Tenant isolation

One deployment holds many books, and **a caller never says which tenant it is**.

- Every table except `tenants` carries `tenantId`, and every index on those
  tables leads with it. A query that forgets the scope cannot use an index.
- `requireTenant(ctx, args)` in `convex/auth.ts` is the only way a function
  learns its tenant. It derives one from the caller's membership rows or from
  the service key's own row.
- `tenantSlug` is accepted as a disambiguator for a caller who belongs to
  several tenants. It is checked against membership before it is believed. There
  is no `tenantId` argument anywhere in the public API, and adding one is the
  bug this section exists to prevent.
- Anything fetched by document id goes through `inTenant(scope, doc)`, which
  throws `not found` for a foreign row. Not `forbidden`: that would confirm the
  row exists, which is the cross-tenant read.
- A service key maps to exactly one tenant, is stored as a SHA-256 hash, and
  carries its own role.
- One function crosses tenants: `forecasts.resolveDue`, the resolver cron. It is
  an `internalMutation` and uses the tenant-less `by_status_due` index. Nothing
  else may use that index, and no new cross-tenant function should exist without
  the same treatment.

When adding a table: `tenantId: v.id("tenants")`, indexes named `by_tenant_*`
with `tenantId` first, `requireTenant` at the top of every handler,
`appendAudit` on every write.

### 2. No provider API key

There is no model API key in this repo, in `.env.example`, or in any code path,
and adding one changes what the project is. Model calls go through
`actor.mts`, which spawns an agent CLI the operator is already signed in to. If
a feature seems to need a key, it needs a CLI invocation instead.

The same rule applies to venue credentials with one difference: a keyed broker
adapter is fine, but its credential lives in the worker process environment. The
backend never receives it and nothing writes it to a table.

## Repo map

pnpm workspace, four tiers. Anything shared between two of them lives in a
package rather than being copied.

| path               | what                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`    | runtime-agnostic primitives: money, calendar, ordering. Its tsconfig sets `types: []` and no DOM lib, because the Convex runtime and the browser bundle both import it             |
| `packages/domain`  | the vocabulary (`ACCOUNT_KINDS`, `AUDIT_KINDS`, ...), the Brier scorer, the criterion parser, the forecast rules and the `VenueAdapter` contract. No dependencies, not even `core` |
| `packages/node`    | node-only shared runtime: env parsing, the Convex transport and watcher, FX, and the venue adapters. Never imported from `convex/` or `browser/`                                   |
| `convex/`          | the backend. `convex/_generated/` is codegen, do not edit. `convex/validators.ts` is where a domain vocabulary becomes a `v.union`                                                 |
| `browser/src/`     | `App.tsx` is the shell and the tabs; each tab is a self-contained `views/<Name>View.tsx`; shared helpers are in `lib/`                                                             |
| `actor.mts`        | CLI dispatch: `ORDERS`, `orderFor`, `nextProvider`, `spawnProvider`, `runActor`                                                                                                    |
| `sync-worker.mts`  | pulls accounts through adapters, converts, snapshots, settles what a quote can settle                                                                                              |
| `agent-worker.mts` | wakes a CLI for what a machine cannot decide                                                                                                                                       |
| `ios/`             | native SwiftUI client over the same Convex backend, XcodeGen spec in `ios/Openportfolio/project.yml`. Not a web view: no `browser/` code reaches it                                 |
| `mcp/`             | stdio MCP server, plain node, imports no workspace package                                                                                                                         |

Intra-package imports end in `.ts`, not `.js`: node strips types but does not
rewrite the extension, so a `.js` specifier resolves to nothing. The same rule
is why `mcp/portfolio-server.mjs` imports no workspace package at all. It runs
under bare node, where a `.ts` specifier would impose a node-version floor on
all 25 tools.

## Run modes

| command                                   | purpose                                                     |
| ----------------------------------------- | ----------------------------------------------------------- |
| `pnpm --filter openportfolio-browser dev` | Vite dev server, UI on `localhost:6101`                     |
| `npx tsx sync-worker.mts [--once]`        | balances, FX, snapshot, forecast settlement                 |
| `npx tsx agent-worker.mts`                | overdue decisions and prose forecasts, through an agent CLI |
| `node mcp/portfolio-server.mjs`           | stdio MCP server                                            |
| `pnpm typecheck`                          | every workspace, src and test alike                         |
| `pnpm test`                               | vitest across packages, convex handlers, browser helpers    |
| `npx convex dev --once`                   | push schema and functions, regenerate `_generated`          |
| `npx convex run <fn> '<json>'`            | manual Convex call                                          |

Tests live in `<module>/test` throughout, and the vitest config runs them as
four projects because the tiers need different environments: node for the
packages and the actor, Convex's edge runtime for the handlers, a DOM for the
browser.

## Forecasts

A forecast carries a probability, a horizon and a resolution criterion, and none
of the three can be edited afterwards. There is no `update` mutation, and adding
one would make the record worthless.

`parseCriterion` reads the simple `SYMBOL comparator VALUE` form and returns
`null` for anything else. Null means "a human settles this", never "it did not
happen": collapsing the two would score every prose forecast as a miss the first
time the cron ran. A criterion that became unresolvable is voided with a reason
and dropped from the mean, not scored as a miss.

Bucket a probability by multiplying, never by dividing by the bucket width.
`0.7 / 0.1` is `6.999999999999999`, which files a 70% call under the 60s.

## Adding a venue adapter

1. Write it in `packages/node/src/adapters/`, implementing `VenueAdapter`.
2. Declare capabilities honestly. An adapter that cannot enumerate holdings
   throws `unsupportedCapability` from `readBalances` rather than returning
   `[]`, because an empty list reads as "you hold nothing" and produces a wrong
   net worth instead of a missing one.
3. Register it in `defaultRegistry()`, or conditionally in the worker when it
   needs configuration. A quote source also needs an entry in
   `QUOTE_VENUE_BY_CLASS`, which is what decides who prices a row. Do not add a
   fallback to another source: both shipped ones answer the wrong instrument
   with an HTTP 200 (Yahoo prices `BTC` as a Grayscale trust, CoinGecko has an
   `aapl` token), and a wrong net worth is worse than a missing one.
4. Credentials come from the worker's environment. Never from a table, never
   from an argument, never from this repo.

## Conventions

- Comments explain why, not what. A comment that restates the line above it is
  noise; a comment naming the bug a line prevents is the reason the line
  survives a refactor.
- `type =`, never `interface`.
- Sequential awaits, never `Promise.all`.
- `for...of`, never a C-style loop or `.forEach()`.
- No ternaries for non-trivial branches: `if/else`, or a `Record` lookup.
- No `as any`, and no non-null `!` in application code. Narrow with `if` and a
  local const. A `as T` at a JSON transport boundary is allowed once per file,
  with a comment saying it is the boundary.
- Named constants at the top of the module, not magic numbers in the body.
- No `useMemo`. Plain helper functions.
- Soft-delete for anything a person wrote. Balance rows are the exception: a
  sync replaces an account's whole position list, because merging leaves a
  sold-out position on the books and overstates net worth silently.
- The audit log is insert-only. Nothing patches it, nothing deletes from it.
- English everywhere, including comments and commit messages. No em dashes, no
  emoji, no `Co-Authored-By`.
- Ambiguous scope means interview first: schema and tenant-gate questions before
  code.
