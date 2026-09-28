---
name: openportfolio-record
description: Check and maintain the scored track record on an openportfolio book - mean Brier, calibration by probability bucket, calls past their horizon, and settling or voiding them. Use when asked how good the forecasts have been, whether a forecaster is calibrated, which calls are due, or to settle a call whose outcome is now known.
---

# Checking the record

Needs the openportfolio MCP server. See the `openportfolio-book` skill for setup.

## Reading it

`calibration` returns the mean Brier score, the expected calibration error, and the reliability buckets behind them. Optional `windowDays`, `author` and `buckets`.

- Brier is the mean of `(probability - outcome)^2` with outcome 1 or 0. Lower is better.
- 0.25 is what saying 50% to everything earns. Above it, the calls are worse than a coin flip.
- Read the buckets, not only the mean. Each bucket compares what was said with how often it happened. Observed below said at the top end is overconfidence, the usual failure. A bucket with three calls in it says very little, so report the count beside the rate.
- Filter by `author` to compare forecasters, including a model against the person using it.

`list_forecasts` (optional `status` of `open`, `resolved` or `void`, `author`, `limit`) lists the calls themselves, newest first.

## Settling what is due

`due_forecasts` lists open calls whose horizon has passed, with the symbol each needs observed.

- A row with a symbol is machine-resolvable. The sync worker settles it on its next pass. Settle it yourself only with a real observation: `settle_forecast` with `forecastId` and `observedValue`, plus a `note` naming the source and time.
- A row with a null symbol is prose and needs reading. Establish whether the criterion was met, then `settle_forecast` with an explicit `outcome` of true or false and a `note` saying how you know.
- If the criterion became unresolvable (the market closed, the event was cancelled, the wording turned out ambiguous), use `void_forecast` with a `reason`. A void drops out of the mean. Never settle a call you cannot establish: a guess scored as an outcome corrupts the record it is meant to test.

A settled call cannot be reopened, and there is no tool that edits one.
