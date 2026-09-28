---
name: openportfolio-book
description: Read an openportfolio book through its MCP server - net worth, accounts, positions, the exposure to one name across accounts, investor flows, and the catalyst calendar. Use when asked what the portfolio holds, what it is worth, how concentrated it is, who has been buying or selling a market, or what is scheduled that touches a holding.
---

# Reading the book

openportfolio holds every account as one book in one base currency. This skill reads it. It never writes, and nothing in openportfolio places an order: there is no tool for it because the backend has no function that does.

## Setup

The tools come from the stdio MCP server in the openportfolio repo. Register it once with your agent CLI, from the repo root:

```bash
claude mcp add openportfolio -- node "$PWD/mcp/portfolio-server.mjs"
```

It reads `CONVEX_DEPLOYMENT`, `OPENPORTFOLIO_SERVICE_KEY` and, optionally, `OPENPORTFOLIO_TENANT` from the environment or from `.env.local` beside it. A service key belongs to exactly one book, so the server cannot see any other. Run `whoami` first when a call is refused: it says which book and which role the key resolved to.

## Order of reading

1. `whoami` for the book and its base currency. Every value below is in that currency unless a row says otherwise.
2. `net_worth` for the total, split by venue and by asset class.
3. `list_accounts`, then `list_balances` (optionally with `accountKey`) for positions.
4. `symbol_exposure` with a `symbol` when a name appears in more than one account. The summed figure is the one that matters for concentration, not the per-account one.
5. `net_worth_history` for recorded snapshots, oldest first. A snapshot is never recomputed, so it shows what the book was worth then at that day's rates.
6. `list_venues` to see what each adapter can actually do. A venue that cannot read balances is priced from rows someone entered.

## Flows and the calendar

- `flow_by_investor` with a `market` (and optional `days`) answers who has been absorbing the supply over a window.
- `list_flows` gives the per-session rows. Check the `currency` and `source` on each: positioning data may be in contracts rather than money.
- `upcoming_catalysts` (optional `windowDays`, `asset`) lists dated forward events: lockups, rebalances, unlocks, prints.

## How to report

- Quote figures with their currency and the date they were recorded. A missing price is a missing number, not a zero: say which row is unpriced rather than summing around it.
- Concentration is a share of the total from `net_worth`, computed from `symbol_exposure`, not from one account.
- Observations and probabilities only. Never recommend a quantity, a price or an order. If a view is worth having, register it with the `openportfolio-forecast` skill so it gets scored.
