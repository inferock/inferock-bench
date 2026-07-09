# covrun Report - 2026-07-04

This is a sanitized historic fixture report for tests. It preserves aggregate covrun facts for parser coverage and baseline provenance; it is not a current public run card and not a provider ranking.

| What to inspect | Section |
| --- | --- |
| Aggregate headline and spend delta | [Headline](#headline) |
| Provider/model/task evidence carried by the run | [Run Mix Evidence](#run-mix-evidence) |
| Surface verdicts and fixture limitations | [Per-Surface Verdicts](#per-surface-verdicts) and [Remediation Findings](#remediation-findings) |

## Headline

SURFACES WATCHED 10/13.

Baseline cumulative provider spend was `$4.802413` at 319 measured calls. Final cumulative provider spend was `$4.841985` at 359 measured calls. Run delta was `$0.039572` across 40 new calls, below the baseline + `$4.00` kill line (`$8.802413`) and baseline + `$5.00` cap (`$9.802413`).

The measurement instance was left running.

## Run Mix Evidence

New calls: 40 total.

Provider deltas:

| provider | calls | delta spend |
|---|---:|---:|
| OpenAI | 22 | `$0.004749` |
| Anthropic | 18 | `$0.034823` |
| Total | 40 | `$0.039572` |

Models observed:

| model | calls |
|---|---:|
| `openai:gpt-4o-mini-2024-07-18` | 22 |
| `anthropic:claude-haiku-4-5-20251001` | 18 |

Preconditions carried in the 40 new calls:

| precondition | run evidence |
|---|---:|
| JSON mode / schema structured output | 4 OpenAI `response_format: json_schema` calls |
| Tool-schema-bound extraction | 6 events with tool declarations, 2 provider tool-use responses |
| Responses tool-call function_call output | 0; the Responses task in this historic run was structured output, not function-tool traffic |
| Streaming / termination evidence | 11 streamed events, 11 complete terminal states |
| Cache usage fields | 9 cache events |
| Cache read tokens | 50,560 |
| Cache creation tokens | 5,760 |
| Repeated drift prompt | 5 normal repeated prompt runs |
| Request/retry headers | 40 events with `x-stainless-retry-count`; 0 positive retry counts |
| Duplicate request-ID groups | 0 |
| Provider safety/content-filter evidence | 0 organic events |
| Factuality contracts captured | 0 |
| Output schema versions captured | 0 |

Cache field breakdown:

| provider | cache events | read tokens | creation tokens |
|---|---:|---:|---:|
| OpenAI | 5 | 33,280 | 0 |
| Anthropic | 4 | 17,280 | 5,760 |

## Per-Surface Verdicts

| surface | run verdict | evidence |
|---|---|---|
| Broken output: bad JSON/schema | watched-clean | 4 real OpenAI JSON-schema structured-output calls; bench summary row moved to `exercised`, count 0. |
| Anthropic output-token recount | signal | Final cumulative row: 63 signals, `triage_only`, `standardLossUsd=$1.622460`, provider-recognized `$0`. Run delta: +2 signals and +`$0.002499` row standard-loss accounting; no provider-recognized or recognition-gap dollars. |
| Duplicate request-ID events | watched-clean | Normal SDK/idempotency evidence carried the operation surface; 0 duplicate groups. Current bench summary represents this as clean watched when operation/body-hash/retry-correlation evidence is captured. |
| Provider latency (Inferock default SLA) | watched | Latency is automatic on all 40 calls. Final cumulative row has 2 pre-existing `LATENCY_BILLED` signals, `unrecognized_standard_loss`, `$0.132710` recognition gap; run delta was +0 latency signals. |
| Tool-call validity | watched-clean for observed Chat/Anthropic tool traffic; Responses function-call sub-surface not-openable | 6 events carried tool declarations and 2 provider tool-use responses; 0 invalid tool-call findings. The Responses structured-output task carried no function-tool declaration/output pair, so Responses row-12 coverage remains separately not-openable in this historic fixture rather than watched-clean. |
| Security/governance overlay | watched-clean | The normal `organic_safety_overlays` task carries the passive inspection precondition; provider safety/secret findings 0. |
| Content-filter overlay | watched-clean | 22 OpenAI completion calls were passively inspected; 0 organic content-filter events. No provocation. |
| Stream-termination overlay | watched-clean | 11 streamed events with positive stream timing evidence; 11 complete terminal states; 0 termination anomaly signals. |
| Retry amplification | watched-clean | 4-way coding-agent SDK wave plus direct concurrency; 40 events with retry-count header, 0 positive retry counts, 0 retry attempt records. No hand retries. |
| Served model mismatch | watched-clean | Provider response model identity was captured; requested and served model identities matched. |
| Cache integrity | signal under current #20 semantics | Normal repeated shared-prefix cache preconditions carried and provider cache usage fields appeared. Under the ratified cache-discount-at-risk rule, cache read usage plus pricing is enough to surface `CACHE_DISCOUNT_AT_RISK`; hosted/imported provider charge observation is still required only for `CACHE_RATE_ANOMALY` charge reconciliation. |
| Drift / regression | not-openable | 5 repeated normal prompts were run. Current bench summary opens this only with a configured drift replay contract or a completed per-model canary baseline; this historic local run had no baseline segment established. |
| Factuality overlay | not-openable | 2 normal known-answer tasks were run. Current bench summary opens this when a captured factuality contract is present; this historic local run did not capture one. |

## New Loss Rows

New signal delta relative to baseline:

| row | count delta | dollar delta | evidence grade | computation trace |
|---|---:|---:|---|---|
| `ANTHROPIC_TOKEN_CROSSCHECK/anthropic_token_crosscheck` | +2 | `standardLossUsd +$0.002499`; provider-recognized `$0`; recognition-gap `$0` | `triage_only` | Historical fixture row predates verified recount traces; current method is `anthropic_count_tokens_recount_v1` when calibration is verified. |
| `LATENCY_BILLED/latency` | +0 | `$0` | `unrecognized_standard_loss` | Final cumulative traces remain the two pre-existing latency rows: observed 21.2s vs 18.0s acceptable and 17.0s vs 15.1s acceptable. |

Total lost dollars did not increase during this run: final total lost stayed `$0.132710`.

## Remediation Findings

1. `cache_integrity` now has two paths: `CACHE_DISCOUNT_AT_RISK` from usage and pricing alone, and `CACHE_RATE_ANOMALY` charge reconciliation when hosted/imported provider charge observation exists. Local BYOK runs without charge data are not-openable only when no at-risk signal fires and charge reconciliation cannot run.
2. `drift_regression` requires either a completed per-model canary baseline segment or an approved replay contract. Repeated prompts alone are not enough to mark the surface openable.
3. `factuality` requires a captured known-answer factuality contract on normal traffic. Known-answer prompts without the contract remain not-openable.
4. Clean overlay/precondition states are represented for duplicate request-ID, content-filter, stream termination, retry amplification, tool-call validity, served-model identity, and security/governance when their normal passive preconditions are carried. Tool-call validity is now provider-surface identified: Chat/Anthropic tool traffic does not mark OpenAI Responses function-call validity watched-clean unless Responses tools and top-level `function_call` output are present.
5. The current coverage denominator is the 13-row `measureRows()` matrix in `apps/inferock-bench/src/summary.ts`; this fixture intentionally preserves the historic traffic counts while using the current surface basis.

## Artifacts

- Phase 0 precondition table: `/tmp/inferock-covrun-assets/preconditions.md`
- Traffic driver: `/tmp/inferock-covrun-assets/covrun-traffic.mjs`
- Report: `/tmp/inferock-covrun-assets/covrun-report.md`

## What to read next

- `covrun-preconditions.md` for the paired code-derived precondition fixture.
- `apps/inferock-bench/src/coverage-suite/baseline.ts` for how this fixture is consumed.
- `docs/public-run-2026-07-06.md` in the public export for the current README proof card.
