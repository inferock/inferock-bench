# Public run card: 2026-07-06

*Published under the pre-exposure-split presentation; from standard vNEXT, cache-discount-at-risk is reported as a separate exposure line, not inside standard-loss.*

This public run is a sanitized aggregate receipt, not raw prompts or raw responses.

Historical note: this card remains the published proof record for the 2026-07-06 visuals and old receipt format; current README visuals and headline facts are refreshed from the 2026-07-09 `inferock-bench` 0.1.10 run.

| First question | Where to look |
| --- | --- |
| What are the three money numbers? | [Three Numbers](#three-numbers) |
| Which providers and signals contributed? | [Provider Aggregates](#provider-aggregates) and [Signal Aggregates](#signal-aggregates) |
| What surfaces did the run open? | [Coverage Aggregate](#coverage-aggregate) |
| What was sanitized out? | [Source Artifacts](#source-artifacts) and [Sanitization](#sanitization) |

- Run id: `inferock-bench-0.1.7-real-traffic-2026-07-06`.
- Package: `inferock-bench` 0.1.7.
- Scope: OpenAI, Anthropic, Gemini.
- Run type: maintainer-owned development-key run, published to prove the artifact path and method. It is not an independent customer audit and not a provider ranking.
- Measured calls: 175.
- Failures: 46.
- Observed provider spend: `$1.28` (stored exact: `$1.280414`).
- Money-native standard-loss: `$4.62` (stored exact: `$4.622887`).
- Provider-recognized: `$0.00`.
- Recognition gap: `$4.62` (stored exact: `$4.622887`).
- Duration loss: `~0s`.
- Provider-recognized time: `~0s`.
- Time recognition gap: `~0s`.

## Source Artifacts

- Public asset provenance: [`../assets/PROVENANCE.md`](../assets/PROVENANCE.md).
- Aggregate receipt used for totals: `memory/benchtest-017-harvest-2026-07-06/aggregate-receipt.json`.
- Event records used for provider aggregates: `memory/benchtest-017-harvest-2026-07-06/events.jsonl`.
- Compact receipt rendered in the public asset: `memory/benchtest-017-harvest-2026-07-06/receipt-compact.txt`.
- Computation trace hash: `sha256:b24c525a90a2076669342caeca8d7dc59138866eb11dbb553029d6c33c85e1f1` (`aggregate-receipt.json`).
- Event-log hash before sanitization: `sha256:85751de272ddb39fe1cd54a21c632520f5e7bf77b8a78e762a53d8ad69fb6837` (`events.jsonl`).

Raw event logs can contain response content, tool schemas, provider IDs, timing, selected headers, and detector evidence. Do not post raw event logs. This card contains only aggregate rows and artifact hashes.

## Three Numbers

| Ledger | Value | Meaning |
| --- | ---: | --- |
| Provider spend observed | `$1.280414` | Provider-priced spend observed by the run. |
| Money-native standard-loss | `$4.622887` | Loss computed under The Inferock Standard for this run. |
| Provider-recognized | `$0.000000` | Amount recognized by provider policy or provider-origin charge evidence in this run. |
| Recognition gap | `$4.622887` | Standard-loss minus provider-recognized. |

## Provider Aggregates

Provider names are shown because the aggregate rows are recoverable from stored artifacts. These rows are run-scoped and should not be read as a provider ranking.

| Provider | Calls | Failures | Observed spend | Standard-loss | Provider-recognized | Recognition gap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenAI | 68 | 0 | `$0.001922` | `$0.000000` | `$0.000000` | `$0.000000` |
| Anthropic | 104 | 46 | `$1.278420` | `$4.622887` | `$0.000000` | `$4.622887` |
| Gemini | 3 | 0 | `$0.000072` | `$0.000000` | `$0.000000` | `$0.000000` |

## Signal Aggregates

| Signal | Failure class | Evidence grade | Count | Standard-loss | Provider-recognized | Recognition gap |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `CACHE_DISCOUNT_AT_RISK` | `cache_discount_at_risk` | `unrecognized_standard_loss` | 29 | `$4.622887` | `$0.000000` | `$4.622887` |
| `ANTHROPIC_TOKEN_CROSSCHECK` | `anthropic_token_crosscheck` | `triage_only` | 17 | `$0.000000` | `$0.000000` | `$0.000000` |

## Coverage Aggregate

- Suite version: `inferock-coverage-suite-v1`.
- Coverage summary method: `inferock-bench-coverage-summary-v1`.
- Surfaces watched: 12 of 13.
- Signals: 47.
- Not-openable surfaces: 1.
- Drift/regression state: baseline collecting, 0 of 3 prior baseline runs completed before current run.

## Generator And Task Mix

The stored speedtest receipt records `generator=built-in` for `speedtest_df3bcf13-ed99-40ee-aa8f-1ae252319b51`.

| Mix item | Calls |
| --- | ---: |
| Built-in coverage speedtest calls with run id | 138 |
| Unscoped development/agent traffic without run id | 37 |
| Agent-generator calls with explicit `generator=agent` metadata | not recorded for this run |
| Drift canary calls | 100 |
| `identical_rerun_drift` | 10 |
| `concurrency_wave` | 8 |
| `json_schema_extract` | 3 |
| `tool_schema_plan` | 3 |
| `automatic_latency_token` | 2 |
| `known_answer_contract` | 2 |
| `long_stream_review` | 2 |
| `organic_safety_overlays` | 2 |
| `sdk_retry_idempotent` | 2 |
| `shared_prefix_cache` | 2 |
| `anthropic_message_baseline` | 1 |
| `openai_responses_structured` | 1 |
| Task id not recorded for this run | 37 |

## Sanitization

This public card does not include prompts, outputs, provider keys, local bench keys, provider request IDs, host paths, raw traces, customer identifiers, or raw event rows.

## What to read next

- [Hard questions](hard-questions.md) for the limits on interpreting this run.
- [Coverage test methodology](coverage-test-methodology.md) for how coverage states are opened without manufacturing failures.
- [Asset provenance](../assets/PROVENANCE.md) for the masking and no-mock trail behind the public images.
