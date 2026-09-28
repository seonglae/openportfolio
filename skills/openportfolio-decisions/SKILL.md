---
name: openportfolio-decisions
description: Keep the deferred-decision queue on an openportfolio book - open a decision with its trigger condition, find the ones that came due, and close them with what happened. Use when a conclusion is "wait for X, then decide", when asked what was supposed to be revisited, or when reviewing overdue decisions.
---

# The deferred-decision queue

"Wait for the print, then decide" evaporates the moment it is said out loud. The queue keeps it: each decision has a trigger condition and stays on the board until it is closed with an outcome.

Needs the openportfolio MCP server. See the `openportfolio-book` skill for setup.

## Opening one

`open_decision` takes a stable `key` you choose, a `title`, the `triggerCondition` that should bring it back, and optionally `detail` and `dueAt` (epoch milliseconds). Give it a `dueAt` whenever the trigger has a date: a decision with no date only comes back when someone remembers it. `upcoming_catalysts` from the `openportfolio-book` skill is where a scheduled trigger usually gets its date.

## Working the queue

1. `overdue_decisions` lists open decisions past their date: the ones that were going to be revisited and were not.
2. For each, establish whether the trigger condition actually fired, reading the book and the flows first.
3. If it fired, `close_decision` with the `key` and a one-line `outcome` saying what happened. Use `status: "void"` when the decision stopped mattering, and say why in the outcome, so an abandoned decision stays distinguishable from a settled one.
4. If it has not fired, leave it open and say why in your reply. Do not close a decision to clear the list.

`list_decisions` (optional `status` of `open`, `done` or `void`) shows the whole queue.

The outcome of a decision is a statement of what happened, not an instruction. Never record a quantity or a price to trade at.
