# Evidence-bound forecasts and honest measurements

This change repairs correctness, not investment performance. All evaluation
fixtures are synthetic and deterministic. No real accounts, bank data, live
orders, paid data providers or private holdings were used.

## Resolution contract

Register probability, horizon, criterion, and (for numeric evidence) a
resolutionTarget before the outcome. The target is immutable and contains a
provider-qualified assetId, symbol, assetClass, venue, and currency.

Two explicit policies exist:

1. `exact` (default): the evidence timestamp must equal `dueAt`. This is for
   sources that can establish that precise observation. A nearby value is not
   substituted. No shipped quote adapter claims this capability.
2. `last_completed_minute`: Yahoo equities and ETFs only. Set assetId to
   `yahoo:AAPL`, symbol to `AAPL`, assetClass to `equity`, venue to `yahoo`,
   currency to `USD`, priceBasis to `provider_close`, sessions to `all`, and
   maxAgeMs to the chosen age (60,000 through 345,600,000 ms) **at registration**.
   The worker requests the full committed interval, verifies symbol, instrument
   type, currency and `dataGranularity=1m`, and chooses the latest non-null
   completed one-minute close at or before the horizon. The timestamp is the
   provider bar start plus one minute. A partial or later bar cannot win.

The minute policy includes provider-returned pre/post-market sessions, requested
with `includePrePost=true`; it does not claim a regular-session closing price.
If a weekend/holiday horizon should admit the prior session, that age must be
chosen in advance. Missing history, retention limits, provider outages and stale
bars leave the call open. The worker never tries another source or widens the
window based on the result. Due rows are paginated, including when the first 100
rows are unsupported or manual calls.

The price basis is Yahoo's historical `indicators.quote.close`, not
`indicators.adjclose`, a current quote, or a guaranteed unadjusted/as-traded
exchange tape. The public Yahoo chart endpoint is an existing best-effort data
source, with no guaranteed availability or immutable history. Corporate actions
and vendor corrections may change later responses. Saved evidence includes the
observed value and identity, source request, observation timestamp, retrieval
clock, and SHA-256 of the parsed response serialized as JSON. The hash provides
an audit fingerprint, not the ability to reconstruct a vendor's old bytes, and
it is not cryptographic attestation from the provider.

A trusted tenant member/service key can record evidence; the backend validates
its contract, not its authenticity independently. Manual calls require a
source note and an explicit outcome after the horizon. A target-bound call
cannot bypass its contract with a manual outcome. Contradictory outcome/value
inputs and repeated settlements are rejected. The audit log records the evidence.

### Existing deployments

The fields are additive. No historical rows are rewritten or silently rescored.
Old symbol-only open forecasts require documented manual resolution; they are
never guessed to be coins or shares. Existing resolved rows without a recorded
resolution method remain visible but are excluded from the primary scored
cohort and counted as `legacyResolved`. The old cron remains callable as a
read-only queue summary; it no longer resolves from mutable balances.

## Scoring and accounting

- Brier is squared probability error, lower is better. Constant 50% scores
  0.25 on any binary outcome. Beating 0.25 does not establish skill: an event-base
  rate comparator may do better.
- `baselineProbability` is registered before outcomes. `paired` reports both
  means and their difference on exactly the same eligible calls, with the shared
  count. It does not compare means from unmatched event sets.
- `observedBaseRate` describes the resolved sample in hindsight. It is not an
  out-of-sample benchmark. Open, void and legacy counts remain visible.
- Confidence intervals are deliberately null: no event identity/dependence
  structure or independence assumption is established, so an IID confidence
  interval would assert more than these records support.
- Net-worth snapshots are valuations at recorded prices and FX rates. Without
  a transaction/cash-flow ledger they are not TWR, IRR or benchmark-relative
  returns. Deposits are not investment profits. Full transaction accounting is
  a separate feature; this PR does not manufacture it from balances.
- CFTC COT rows retain commercial, non-commercial and non-reportable categories.
  Non-reportable is not synonymous with retail. Weekly net-position changes are
  contracts, not cash buying. Open interest is separate from turnover. Legacy
  COT rows are normalized on read and matched on upsert without double counting;
  restatements are audited. Mixed units, measurement types or sources cannot be
  silently aggregated.
- Demo dates are fixed, displayed forecast scores/counts derive from displayed
  synthetic outcomes, and the disclosure remains visible even with `?bare=1`.

## Comparator lessons adopted

| Matched comparison                                | Useful lesson                                               | Integration and verification                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Wealthfolio vs OpenPortfolio valuations           | Label the return method and missing inputs                  | Net-worth UI/docs explicitly distinguish valuations from cash-flow-adjusted returns; no fabricated returns        |
| Portfolio Performance vs OpenPortfolio accounting | Deposits/withdrawals affect the return calculation          | Preserve price/FX snapshot semantics; state that TWR/IRR need cash-flow history                                   |
| Metaculus vs OpenPortfolio forecast record        | Immutable questions, explicit resolution, proper scoring    | Target-bound evidence, post-horizon manual source notes, append-only resolution audit, Brier validation           |
| ForecastBench vs OpenPortfolio comparisons        | Different event sets/difficulties make raw means misleading | Preregistered paired baseline scores with shared counts, descriptive base rate, no unsupported significance claim |

Sources checked 2026-10-13:
[Wealthfolio performance metrics](https://wealthfolio.app/docs/concepts/performance-metrics/),
[Portfolio Performance TTWROR](https://help.portfolio-performance.info/en/concepts/performance/time-weighted/),
[Metaculus scores](https://www.metaculus.com/help/scores-faq/),
[ForecastBench methodology](https://forecastbench.org/assets/pdfs/forecastbench_updated_methodology.pdf).
These are scoped lessons, not claims of feature parity or superior forecast returns.

## PR checklist and deterministic evidence

Base: `8b7765fa3967a48e87278236c91f469a3ebb9163`.
The unchanged base suite passed **232/232**, but did not catch the semantic
failures. The same 12 added adversarial assertions were run in a clean base
worktree and on this branch: **0/12 to 12/12 passing**. This is a regression
fixture result, not an estimate of production accuracy or investment alpha.

| Defect                                                 | Code                                               | Before/after regression and final coverage                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Past/future balances used as horizon evidence          | convex/forecasts.ts                                | Two identical balance-time cases: fail on base, pass on branch                                                                                           |
| Early/unqualified settlement                           | domain/forecast.ts; convex/forecasts.ts            | Two identical guard cases: fail on base, pass on branch; identity/currency/tenant/manual-bypass cases                                                    |
| Invented quote timestamps/currency or wrong instrument | node/adapters/{coingecko,yahoo}.ts                 | Four identical metadata cases: fail on base, pass on branch                                                                                              |
| COT participant/open-interest mislabel                 | domain/flow.ts; convex/flows.ts; node/flows/cot.ts | Two identical label cases: fail on base, pass on branch; normalization/restatement/mixed-unit cases                                                      |
| Nonfinite horizon/observation                          | domain/forecast.ts                                 | Two identical numeric cases: fail on base, pass on branch                                                                                                |
| Live-quote/AAPL collision in worker                    | node/settlement.ts; sync-worker.mts                | No live fallback; supported Yahoo historical fixture; failure remains pending                                                                            |
| Supported calls starved behind old rows                | listDuePage; drainHistoricalForecasts              | Full worker orchestration to provider fixture to Convex: 101 pending calls ahead of a supported call, pages of 100 and 2, one audited correct settlement |
| Hindsight time window / provider granularity           | historical Yahoo adapter                           | Fixed-window request, partial/later/stale bars, precommitted weekend age, metadata drift, duplicate timestamps                                           |
| Universal 0.25 skill claim                             | brier.ts; calibration query; browser/iOS           | Forecast 0.10 vs registered base-rate 0.09 shows why below 0.25 alone is insufficient                                                                    |
| Inconsistent synthetic score claims                    | demo/fixtures.ts; demo/main.tsx                    | Score/count consistency test; fixed epoch; disclosure cannot hide                                                                                        |

Reproduce:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm exec vitest run semantic-regressions.test.ts settlement-regressions.test.ts
pnpm --filter openportfolio-browser build
pnpm --filter openportfolio-browser build:demo
```

No deployment or merge is part of this change. iOS score-color semantics are
updated, but native Xcode compilation requires macOS and is not claimed by the
Node/Convex/browser checks.
