---
name: openportfolio-record
description: Check and maintain the scored track record on an openportfolio book - mean Brier, calibration by probability bucket, calls past their horizon, and settling or voiding them. Use when asked how good the forecasts have been, whether a forecaster is calibrated, which calls are due, or to settle a call whose outcome is now known.
---

# Checking the record

Needs the openportfolio MCP server. See the `openportfolio-book` skill for setup.

## Reading it

`calibration` returns the mean Brier score, the expected calibration error, and the reliability buckets behind them. Optional `windowDays`, `author` and `buckets`.

- Brier is the mean of `(probability - outcome)^2` with outcome 1 or 0. Lower is better.
- 0.25 is what saying 50% to everything earns; beating it alone does not establish skill. Read paired baseline scores and their shared count. Open, void and legacy unaudited settlements are reported separately. No confidence interval is claimed because event dependence is unknown.
- Read the buckets, not only the mean. Each bucket compares what was said with how often it happened. Observed below said at the top end is overconfidence, the usual failure. A bucket with three calls in it says very little, so report the count beside the rate.
- Filter by `author` to inspect a forecaster. Means on different event sets are not a fair head-to-head comparison.

`list_forecasts` (optional `status` of `open`, `resolved` or `void`, `author`, `limit`) lists the calls themselves, newest first.

## Settling what is due

`due_forecasts` lists open calls whose horizon has passed, with the symbol each needs observed.

- A row with a supported resolutionTarget can be settled by the worker from historical evidence under the policy frozen at registration. A symbol alone is insufficient. For `settle_forecast`, observedValue requires evidence matching the assetId, symbol, assetClass, venue, currency and registered time policy, with a source. Never use a current price for an old horizon or widen the allowed age after seeing prices.
- Legacy symbol-only calls require a documented manual outcome and source note. Calls with a committed target cannot bypass it with a manual outcome. Both paths reject early settlement; do not pass outcome and observedValue together.
- A row with a null symbol is prose and needs reading. Establish whether the criterion was met, then `settle_forecast` with an explicit `outcome` of true or false and a `note` saying how you know.
- If the criterion became unresolvable (the event was cancelled or the wording turned out ambiguous), use `void_forecast` with a `reason`. A void drops out of the mean. Never settle a call you cannot establish: a guess scored as an outcome corrupts the record it is meant to test.

A provider outage or a market closure alone is not an outcome and is not a reason to silently void a call.

A settled call cannot be reopened, and there is no tool that edits one.
