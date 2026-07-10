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
- Package: `inferock-bench` 0.1.10.
- Scope: Anthropic, OpenAI, and pinned OpenRouter endpoints.
- Run type: maintainer-owned development-key run, adaptive issue-weighted mix. This is deliberately disclosed because the run targeted known/active issue surfaces after the 2026-07-09 baseline.
- Corrected run15 ledger calls: 1,161.
- Corrected run15 ledger failures/signals: 537.
- Corrected observed provider spend: `$5.440472`.
- Corrected bill-bounded money loss: `$0.084930`.
- Corrected time loss: `174,123 ms` (`~2.9 min`).
- Corrected time translation: `$4.449810` at the default rate assumption in [SLA defaults](../spec/sla-defaults.md#time-value).
- Corrected invoice-check exposure: `$0.000000` in the closeout ledger.

## Source Artifacts

- Public asset provenance: [`../assets/PROVENANCE.md`](../assets/PROVENANCE.md).
- Private component source: versioned maintainer S3 component store, prefix `store/components/run15-2026-07-10/`.
- S3 run15 store archive hash: `sha256:c89a5afcf7a34d7d575475af41713eb034d9bd49454594150bf5e6c2a55d54a0` (`inferock-store-sanitized.tgz`, 1,616,918 bytes).
- S3 run15 event-log hash after archive extraction: `sha256:847a49ee9adb05b8b8f668770eae6369c217708b84077753a927cb9d2d4cf640` (`events.jsonl`, 13,013,046 bytes).
- Run15 artifacts archive hash: `sha256:2818d3159a2053391364c9d1310bcce31996db3c6efa0326ef1a8596f6a940d4` (`run15-artifacts.tgz`, 1,323,844 bytes).
- Corrected closeout ledger hash: `sha256:b46a551b0751b4f8b775539ac650d9d6a3407a3fa61ed195baa0c314fa7e10e6` (`final-ledger-corrected.json`, 10,649 bytes).
- Surface matrix hash: `sha256:a44dcffff0446492c8e58c55b5b1287ef59a839e0ccb1e1ce0b45ed903426963` (`surface-matrix.json`, 75,532 bytes).
- Current-code retained-run receipt hash after post-merge four-element headline render: `sha256:7565ea0a04f0268983ae3c0a9fad41ad5065cd57fac1fc9f2208c6cf94fc7027` (`run15-retained-receipt.json`, 43,173 bytes).
- Current-code retained compact receipt hash after public path/watermark masking: `sha256:366c6d2cb2c645d50a56669b1c4a44cf98d58a8c2658139683fc18214bd9219e` (`run15-retained-receipt-compact.txt`, 6,827 bytes).
- Current-code retained share-card hash: `sha256:e6df4bf9d56ea203d0312640d21bde40097e54dbc0b59ece9d7eb3f20186a163` (`run15-retained-share-card.txt`, 1,795 bytes).

Raw event logs can contain response content, tool schemas, provider IDs, timing, selected headers, and detector evidence. Do not post raw event logs. This card contains only aggregate rows and artifact hashes.

## Run Summary

The corrected closeout ledger is the run15 accounting ledger. It includes extractor-backed rows for artifacts that were not preserved as full reusable receipt JSON.

| Ledger | Value | Meaning |
| --- | ---: | --- |
| Provider spend observed | `$5.440472` | Provider-priced spend observed by run15. |
| Money loss | `$0.084930` | Corrected closeout bill-bounded loss. |
| Time loss | `~2.9 min` | Time ledger impact; it is not added to money loss. |
| Time translation | `$4.449810` | Secondary at-rate translation at the default rate assumption in [SLA defaults](../spec/sla-defaults.md#time-value). |
| Calls | `1,161` | Run15 calls after excluding the seed/carry-forward row. |
| Failures/signals | `537` | Corrected closeout failure/signal count. |

## Current-Code Receipt Re-Render

The event-store receipt re-render is the path used for cumulative public images. It recomputes from `events.jsonl` only, so it does not include manually recovered closeout rows that were outside durable receipt JSON.

| Receipt field | Current-code retained run15 value |
| --- | ---: |
| Calls | `1,161` |
| Failures/signals | `532` |
| Provider spend observed | `$5.440472` |
| Bill-bounded money loss | `$0.073504` |
| Provider-recognized | `$0.052524` |
| Recognition gap | `$0.020980` |
| Time loss | `~2.9 min` |
| Time translation | `$4.449810` |
| Invoice-check exposure | `$14.288267` across 183 cache-discount-at-risk exposures |
| Surfaces watched | `12 / 13` |

Receipt persistence defect: two corrected closeout rows were recovered from event/per-call extractor evidence but not available as full durable receipt JSON. `speedtest_9a11ac8e-818a-4834-9a6f-174ac8fa8742` was stdout-only/truncated by SSM display, and `speedtest_b55b5dad-62e5-434d-b279-30f6d826b40b` had its output file overwritten by a later pass. The corrected closeout ledger is retained for run15 accounting; the cumulative README/capture receipt uses the current-code event-store re-render and therefore shows the lower recomputed money-loss/failure totals.

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
- Current-code cumulative receipt hash after post-merge four-element headline render: `sha256:8342ebbed8743b2602bdf4256171d38891d0fa73d9705da763879f24e4a51d3b` (`cumulative-receipt.json`, 44,318 bytes).
- Current-code cumulative compact receipt hash after public path/watermark masking: `sha256:273d92698595c49feb495f6b05280b4356c5b8b83fdad8cf9d1e7aeedab67ee0` (`cumulative-receipt-compact.txt`, 6,787 bytes).
- Current-code cumulative share-card hash: `sha256:9f60d0afb73ad1131d8fcb93a0651d5357243e01bfe647823e7759883764a34c` (`cumulative-share-card.txt`, 1,795 bytes).
- Public capture hash: `sha256:b331f9d2d6cc63c4a01b581c054f826027eda17eee26acbbcc0836c4c13cc7f5` (`assets/receipt-real-traffic.png`, 533,898 bytes).
- Public capture hash: `sha256:37d604d422ea9177b41b1775b0b547708a5ff0480a371968bde1e10f17687c97` (`assets/dashboard-real-traffic.png`, 96,230 bytes).
- Public capture hash: `sha256:e1d5f96c49d28636fc53a53f803e367df8eb186f1a2077a290f3e62cfc02afc6` (`assets/bench-demo.gif`, 265,014 bytes).

The cumulative current-code receipt renders the four-element headline: `spent $7.15 · money loss $0.07 · time loss ~2.9 min · invoice-check exposure $16.80`. It also renders `money loss = 1.0% of observed spend` and `cache discount at risk -- verify your invoice: 202 invoice exposures, $16.80`.

## Provider Aggregates

Provider rows are from the corrected run15 closeout ledger. They are run-scoped and should not be read as a provider ranking.

| Provider | Calls | Failures | Observed spend | Money loss | Time loss | Time translation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Anthropic | 633 | 131 | `$4.618909` | `$0.032406` | `10,657 ms` | `$0.272345` |
| OpenAI | 274 | 261 | `$0.731450` | `$0.047040` | `0 ms` | `$0.000000` |
| OpenRouter pinned endpoints | 254 | 145 | `$0.090113` | `$0.005484` | `163,466 ms` | `$4.177465` |

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
| `OPENAI_TOKEN_RECOUNT_MISMATCH` | `token_recount_mismatch` | `refundable_candidate` | 259 | bill-bounded money loss | `$0.047040` | `$0.047040` | `$0.000000` |
| `REFUSAL_BILLED` | `refusal` | `unrecognized_standard_loss` | 12 | bill-bounded money loss | `$0.020980` | `$0.000000` | `$0.020980` |
| `BILLED_EMPTY` | `empty_output` | `refundable_candidate` | 9 | bill-bounded money loss | `$0.005484` | `$0.005484` | `$0.000000` |
| `ANTHROPIC_TOKEN_CROSSCHECK` | `anthropic_token_crosscheck` | `triage_only` | 57 | triage-only | `$0.000000` | `$0.000000` | `$0.000000` |
| `FACTUALITY_KNOWN_ANSWER_FAIL` | `factuality_contradiction` | `triage_only` | 2 | triage-only | `$0.000000` | `$0.000000` | `$0.000000` |
| `CACHE_DISCOUNT_AT_RISK` | `cache_discount_at_risk` | `invoice-check exposure` | 183 | exposure | not included | not included | not included |

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
