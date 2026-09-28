---
name: openportfolio-forecast
description: Register a call on an openportfolio book before the fact - a probability, a horizon and the condition that settles it - so it is Brier-scored when the horizon passes. Use when a model or a person states a directional view, says something "will" or "should" happen, or asks to put a prediction on the record.
---

# Registering a forecast

A view that is never scored costs nothing to be wrong about. openportfolio registers it with a probability, a horizon and a resolution criterion, and none of the three can be edited afterwards. There is no update tool, on purpose: a call that can be revised after the fact is a record of nothing.

Needs the openportfolio MCP server. See the `openportfolio-book` skill for setup.

## The call

`record_forecast` takes:

| argument              | rule                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| `subject`             | what the call is about, in plain words                                            |
| `probability`         | 0 to 1. The chance the criterion is met, not a confidence in the reasoning        |
| `horizonSec`          | seconds until it comes due. At least 3600, at most five years                     |
| `resolutionCriterion` | the condition that settles it                                                     |
| `rationale`           | optional, why                                                                     |
| `author`              | optional, who made it, for example `claude`. The record can be filtered by author |
| `authorType`          | optional, `agent` or `user`                                                       |

## Write a criterion a machine can settle

The form `SYMBOL comparator VALUE` settles itself when the horizon passes, with no one having to remember:

```
BTC > 100000
VWRL >= 118.5
KOSPI < 3,000
```

Comparators are `>`, `>=`, `<`, `<=`, `==`, `!=`. Symbols may carry dots, colons, slashes and dashes (`035420.KS`, `BRK-B`). Anything else, for example "the central bank cuts in March", is valid but prose: it waits in `due_forecasts` with a null symbol until someone settles it by hand. Prefer the machine form whenever the claim allows it.

The symbol is observed through the sync worker's quote source, which is CoinGecko unless the operator pinned another with `OPENPORTFOLIO_QUOTE_VENUE`. A share ticker in a criterion only settles itself on a deployment priced by a source that knows it.

## Before registering

- Choose the probability before looking for reasons, then check it against the record with the `openportfolio-record` skill. A forecaster whose 80% calls land half the time should say 60%.
- 0.5 registers a coin flip. It scores 0.25 whatever happens, which is the line every other call is measured against.
- Check `list_forecasts` for an open call on the same subject. A second call is a new record, not a correction of the first.
- A call is not a recommendation. Never attach a size, a price to trade at, or an instruction to buy or sell.
