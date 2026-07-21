# Public run card: 2026-07-10

This public run is a sanitized aggregate run card, not raw prompts or raw responses.

Use this as the proof card for the 2026-07-10 run15 contribution to the cumulative public receipt. The run was adaptive and issue-weighted, so this card discloses the denominator, task mix, provider scope, and receipt persistence caveat under the Denominator Rules. It is not an independent customer audit and not a provider ranking.

| First question | Where to look |
| --- | --- |
| What did run15 add? | [Run Summary](#run-summary) |
| Which receipt facts changed under current code? | [Current-Code Receipt Re-Render](#current-code-receipt-re-render) |
| How was the cumulative store reconciled? | [Cumulative Store Reconciliation](#cumulative-store-reconciliation) |
| What was the adaptive mix? | [Task Mix](#task-mix) |
| Which providers contributed? | [Provider Aggregates](#provider-aggregates) |
| What was sanitized out? | [Source Artifacts](#source-artifacts) and [Sanitization](#sanitization) |

- Run id: `run15-2026-07-10`.
- Original capture package: `inferock-bench` 0.1.10.
- Grading package used for this card: `inferock-bench` 0.2.3.
- Run-card freshness: current-public-run-card; grading version: `inferock-bench` 0.2.3.
- Regeneration note: regenerated 2026-07-21 with `inferock-bench` 0.2.3 grading from the stored real event stores. The 0.2.1 verified-tokenizer gate still keeps 259 OpenAI recount rows at `triage_only`; the Batch A latency evidence update keeps 10 latency signals but changes retained run15 time loss from `174,123 ms` to `172,915 ms`. The cumulative ledger also drops from 565 to 564 failure signals because the 2026-07-09 component's prior `TRUNCATED` money row no longer contributes under current grading. No provider calls were made during regeneration.
- Scope: Anthropic, OpenAI, and pinned OpenRouter endpoints.
- Run type: maintainer-owned development-key run, adaptive issue-weighted mix. This is deliberately disclosed because the run targeted known/active issue surfaces after the 2026-07-09 baseline.
- Current stored-event calls: 1,161.
- Current stored-event failures/signals: 532 (signals-vs-calls counting: triage-only findings remain receipt signals, not refund claims).
- Observed provider spend: `$5.440472`.
- Bill-bounded money loss: `$0.026464` (exposure-vs-money-loss distinction: invoice-check exposure is not booked as money loss).
- Provider-recognized: `$0.005484`.
- Recognition gap: `$0.020980`.
- Time loss: `172,915 ms` (`~2.9 min`).
- Time translation: `$4.418940` at the default rate assumption in [SLA defaults](../spec/sla-defaults.md#time-value).
- Invoice-check exposure: `$14.288267` across 183 cache-discount-at-risk exposures (verify against the invoice; not money loss).

## Source Artifacts

- Public asset provenance: [`../assets/PROVENANCE.md`](../assets/PROVENANCE.md).
- Private component source: versioned maintainer S3 component store, prefix `store/components/run15-2026-07-10/`.
- S3 run15 store archive hash: `sha256:c89a5afcf7a34d7d575475af41713eb034d9bd49454594150bf5e6c2a55d54a0` (`inferock-store-sanitized.tgz`, 1,616,918 bytes).
- S3 run15 event-log hash after archive extraction: `sha256:847a49ee9adb05b8b8f668770eae6369c217708b84077753a927cb9d2d4cf640` (`events.jsonl`, 13,013,046 bytes).
- Run15 stored-event hash after dropping the documented seed/carry-forward row: `sha256:3cc2201f938a457e789de7b75bb91b4ffa672b7feb20bd3c427823776e654e7b` (`events.jsonl`, 13,008,735 bytes).
- Run15 artifacts archive hash: `sha256:2818d3159a2053391364c9d1310bcce31996db3c6efa0326ef1a8596f6a940d4` (`run15-artifacts.tgz`, 1,323,844 bytes).
- Legacy 0.1.10 closeout ledger hash, retained as a historical source artifact and not used for current 0.2.3 public headline figures: `sha256:b46a551b0751b4f8b775539ac650d9d6a3407a3fa61ed195baa0c314fa7e10e6` (`final-ledger-corrected.json`, 10,649 bytes).
- Surface matrix hash: `sha256:a44dcffff0446492c8e58c55b5b1287ef59a839e0ccb1e1ce0b45ed903426963` (`surface-matrix.json`, 75,532 bytes).
- Current-code stored-event receipt hash after 0.2.3 grading render: `sha256:c9a9f7264ee0f489e3410a0b1b5a458dd32e8d0c775925ee5ea2d7b6a184ed2d` (`run15-retained-receipt.json`, 50,819 bytes).
- Current-code stored-event compact receipt hash after public path/watermark masking: `sha256:6a5ec21481630e525e8353596f3919ee39dcbbbd16ec1dfc6ef37a92a08f77ab` (`run15-retained-receipt-compact.txt`, 7,927 bytes).
- Current-code stored-event share-card hash: `sha256:454ffb2334df5cab5bc36300032b66c67cc7f9d0b788bb909e1d4948f35e90ae` (`run15-retained-share-card.txt`, 1,872 bytes).

Raw event logs can contain response content, tool schemas, provider IDs, timing, selected headers, and detector evidence. Do not post raw event logs. This card contains only aggregate rows and artifact hashes.

## Run Summary

The current public run15 figures are the stored-event re-render through `inferock-bench` 0.2.3. The older 0.1.10 closeout ledger remains listed above as a source artifact because it explains the July 10 publication history, but its pre-gate tokenizer dollar rows are not used for the current headline.

| Ledger | Value | Meaning |
| --- | ---: | --- |
| Provider spend observed | `$5.440472` | Provider-priced spend observed by run15. |
| Money loss | `$0.026464` | 0.2.3 bill-bounded loss; invoice-check exposure stays separate. |
| Provider-recognized | `$0.005484` | Amount recognized by provider policy or provider-origin charge evidence in this run. |
| Recognition gap | `$0.020980` | Bill-bounded money loss minus provider-recognized recovery. |
| Time loss | `~2.9 min` | Time ledger impact; it is not added to money loss. |
| Time translation | `$4.418940` | Secondary at-rate translation at the default rate assumption in [SLA defaults](../spec/sla-defaults.md#time-value). |
| Calls | `1,161` | Run15 calls after excluding the seed/carry-forward row. |
| Failures/signals | `532` | Receipt findings under signals-vs-calls counting; `triage_only` rows count as signals but contribute `$0`. |

## Current-Code Receipt Re-Render

The event-store receipt re-render is the path used for cumulative public images. It recomputes from the retained `events.jsonl` through the current shipped grading code, with provider-key environment variables omitted during rendering.

| Receipt field | Current-code retained run15 value |
| --- | ---: |
| Calls | `1,161` |
| Failures/signals | `532` |
| Provider spend observed | `$5.440472` |
| Bill-bounded money loss | `$0.026464` |
| Provider-recognized | `$0.005484` |
| Recognition gap | `$0.020980` |
| Time loss | `~2.9 min` |
| Time translation | `$4.418940` |
| Invoice-check exposure | `$14.288267` across 183 cache-discount-at-risk exposures |
| Surfaces watched | `12 / 13` |

The stored event log contains the formerly manual run IDs (`speedtest_9a11ac8e-818a-4834-9a6f-174ac8fa8742` and `speedtest_b55b5dad-62e5-434d-b279-30f6d826b40b`), so no run15 event-store figure above is filled from a guessed or synthetic row. The number change is a grading change: 259 OpenAI recount rows without verified tokenizer evidence now render as `triage_only`, so their `$0.047040` pre-gate money/provider-recognized dollars become `$0`.

## Cumulative Store Reconciliation

The cumulative render store was assembled from the 2026-07-09 component plus run15, with provider-key environment variables omitted during rendering.

| Component | Event rows | Reconciliation note |
| --- | ---: | --- |
| `newrun-2026-07-09-events.jsonl` | 107 | retained in full |
| run15 S3 archive, raw extracted event rows | 1,162 | includes one seed/carry-forward row |
| run15 seed/carry-forward row dropped | -1 | `speedtest_20f50256-1816-4078-97af-2b9582c15c44`, absent from the corrected run15 ledger |
| stable-key overlap after seed drop | 0 | no further duplicate event identity found |
| cumulative event store | 1,268 | 107 + 1,161 - 0 |

- Cumulative event-store hash: `sha256:7921fcd7b83799c5a61f098ee7726ff5c20db5a07675b3758309998a5baf7fd0` (`events.jsonl`, 14,156,571 bytes).
- Current-code cumulative receipt hash after 0.2.3 grading render: `sha256:a28056ebb87032442d3cb892909ef84f53e3262f1242fdd8aa843acc1b046e9f` (`cumulative-receipt.json`, 51,576 bytes).
- Current-code cumulative compact receipt hash after public path/watermark masking: `sha256:c583807b681c60ed4fc00b0444adcadb30cbf719dba4188787cee9adcf28ba26` (`cumulative-receipt-compact.txt`, 7,875 bytes).
- Current-code cumulative share-card hash: `sha256:8dae4d0d89298283fae9c63e1216d99006d31a4504fde6174fa050221190a174` (`cumulative-share-card.txt`, 1,872 bytes).
- Public capture hash: `sha256:dd56913650d074ba6153942de7fd365fefb8f972f650410ea5df0d0e0c7f6111` (`assets/receipt-real-traffic.png`, 363,127 bytes).
- Public capture hash: `sha256:a1082390aa40aaafe674e6f67386d3bf5e6cbc25617cb2ab966fe5ab49154f17` (`assets/dashboard-real-traffic.png`, 227,017 bytes).

The cumulative current-code receipt renders the four-element headline: `spent $7.15 · money loss $0.03 · time loss ~2.9 min · invoice-check exposure $16.80`. It also renders `money loss = 0.4% of observed spend` and `cache discount at risk -- verify your invoice: 202 invoice exposures, $16.80`. This cumulative ledger is an issue-weighted adaptive traffic mix; its current receipt has 564 failures/signals, failures/signals are receipt findings rather than unique calls, and invoice-check exposure is separated from booked money loss.

## Provider Aggregates

Provider rows below disclose scope, calls, and observed spend from the retained run15 event store. Current 0.2.3 loss grading is reported by signal row, not by provider ranking.

| Provider | Calls | Observed spend | Current grading note |
| --- | ---: | ---: | --- |
| Anthropic | 633 | `$4.618909` | Anthropic token cross-check rows remain `triage_only`; refusal rows carry the bill-bounded money gap. |
| OpenAI | 274 | `$0.731450` | 259 tokenizer-unverified recount rows reclassified to `triage_only` and contribute `$0`. |
| OpenRouter pinned endpoints | 254 | `$0.090113` | Billed-empty rows carry provider-recognized money loss; latency rows stay in the time ledger. |

## Task Mix

This was an adaptive issue-weighted run, not a random traffic sample. The table below is derived from the retained 1,161 event rows.

| Mix item | Calls |
| --- | ---: |
| Unscoped/local agent and follow-up traffic | 429 |
| Drift canary benchmark items (`gsm8k` and `mmlu`) | 385 |
| `identical_rerun_drift` | 145 |
| `concurrency_wave` | 52 |
| `long_stream_review` | 35 |
| `shared_prefix_cache` | 35 |
| `known_answer_contract` | 18 |
| `sdk_retry_idempotent` | 13 |
| `automatic_latency_token` | 13 |
| `organic_safety_overlays` | 13 |
| `json_schema_extract` | 9 |
| `tool_schema_plan` | 7 |
| `openai_responses_structured` | 4 |
| `anthropic_message_baseline` | 3 |

## Signal Aggregates

Signal rows are from the current-code event-store receipt re-render, so they match the cumulative image path.

| Signal or exposure | Failure class | Evidence grade | Count | Primary ledger | Money loss | Provider-recognized | Recognition gap |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: |
| `LATENCY_BILLED` | `latency` | `unrecognized_standard_loss` | 10 | time loss | not money loss | `$0.000000` / `~0s` | `~2.9 min` |
| `REFUSAL_BILLED` | `refusal` | `unrecognized_standard_loss` | 12 | bill-bounded money loss | `$0.020980` | `$0.000000` | `$0.020980` |
| `BILLED_EMPTY` | `empty_output` | `refundable_candidate` | 9 | bill-bounded money loss | `$0.005484` | `$0.005484` | `$0.000000` |
| `ANTHROPIC_TOKEN_CROSSCHECK` | `anthropic_token_crosscheck` | `triage_only` | 57 | triage-only | `$0.000000` | `$0.000000` | `$0.000000` |
| `FACTUALITY_KNOWN_ANSWER_FAIL` | `factuality_contradiction` | `triage_only` | 2 | triage-only | `$0.000000` | `$0.000000` | `$0.000000` |
| `OPENAI_TOKEN_RECOUNT_MISMATCH` | `token_recount_mismatch` | `triage_only` | 259 | triage-only | `$0.000000` | `$0.000000` | `$0.000000` |
| `CACHE_DISCOUNT_AT_RISK` | `cache_discount_at_risk` | `invoice-check exposure` | 183 | exposure | not included | not included | not included |

Why the OpenAI row moved: the 0.2.1 verified-tokenizer gate, still active in 0.2.3, requires verified tokenizer evidence before a visible-output recount mismatch can become a refundable candidate. The stored run15 rows lack that verified-tokenizer basis, so current shipped grading keeps the signals visible but removes their refundable/provider-recognized dollars.

## Coverage Aggregate

- Suite version: `inferock-coverage-suite-v1`.
- Coverage summary method: `inferock-bench-coverage-summary-v1`.
- Current-code retained run15 surfaces watched: 12 of 13.
- Signals reported by coverage: 264.
- Not-openable surfaces: 1.
- Unopened surface: `Drift / regression` (`drift_regression`) because the drift canary baseline was still collecting.

## Sanitization

This public card does not include prompts, outputs, provider keys, local bench keys, provider request IDs, host paths, raw traces, customer identifiers, or raw event rows.

Provider and local bench keys were not used for re-rendering. The re-render used harvested event stores only, with provider-key environment variables omitted from the receipt-rendering process. Public text artifacts were checked for `ibl_`, `sk-`, `/home/*`, `/Users/*`, and `ec2-user` before hashing.

## What to read next

- [Public run card: 2026-07-09](public-run-2026-07-09.md) for the first 0.1.10 public component in the cumulative receipt.
- [Hard questions](hard-questions.md) for the limits on interpreting public runs.
- [Coverage test methodology](coverage-test-methodology.md) for how coverage states are opened without manufacturing failures.
- [Asset provenance](../assets/PROVENANCE.md) for the masking and no-mock trail behind public images.
