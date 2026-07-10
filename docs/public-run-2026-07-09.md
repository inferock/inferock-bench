# Public run card: 2026-07-09

This public run is a sanitized aggregate receipt, not raw prompts or raw responses.

Use this as the proof card for the first 0.1.10 public component in the cumulative README ledger. It shows what the 2026-07-09 run measured, what was deliberately withheld from the public artifact, and why the rows are run-scoped rather than a provider ranking.

| First question | Where to look |
| --- | --- |
| What is the receipt headline? | [Receipt Headline](#receipt-headline) |
| Which exposure is separate from money loss? | [Invoice-Check Exposure](#invoice-check-exposure) |
| Which providers and signals contributed? | [Provider Aggregates](#provider-aggregates) and [Signal Aggregates](#signal-aggregates) |
| What surfaces did the run open? | [Coverage Aggregate](#coverage-aggregate) |
| What was sanitized out? | [Source Artifacts](#source-artifacts) and [Sanitization](#sanitization) |

- Run id: `inferock-bench-0.1.10-real-traffic-2026-07-09`.
- Package: `inferock-bench` 0.1.10.
- Scope: OpenAI, Anthropic, Gemini.
- Run type: maintainer-owned development-key run, published to prove the artifact path and method. It is not an independent customer audit and not a provider ranking.
- Measured calls: 107.
- Failures/signals: 33.
- Provider-error events: 3.
- Observed provider spend: `$1.71` (stored exact: `$1.713128`).
- Bill-bounded money loss: `$0.00` (stored exact: `$0.000371`).
- Provider-recognized: `$0.000371`.
- Recognition gap: `$0.00` (stored exact: `$0.000000`).
- Time loss: `~0s`.
- Provider-recognized time: `~0s`.
- Time recognition gap: `~0s`.
- Invoice-check exposure: `$2.51` (stored exact: `$2.508918`) across 19 cache-discount-at-risk signals.

## Source Artifacts

- Public asset provenance: [`../assets/PROVENANCE.md`](../assets/PROVENANCE.md).
- Harvested event records used for the re-render: `scratchpad/newrun/newrun/events.jsonl`.
- Re-render method: copied the harvested event store into an isolated `INFEROCK_BENCH_HOME`, scrubbed provider-key environment variables, and ran `inferock-bench` 0.1.10 receipt commands against the event store.
- Re-rendered aggregate receipt hash: `sha256:1a043d5673ec02599ce2bff22918173a2ed5f93f5727789ccaccd3a368db1c06` (`aggregate-receipt.json`, 36,445 bytes).
- Re-rendered compact receipt hash after public path/watermark masking: `sha256:96a295d3d81e8c0f12bc8a0fccae530537faa7706e688478d5987e2cf2bf1258` (`receipt-compact.txt`, 3,071 bytes).
- Re-rendered share-card hash: `sha256:12eb82f5af9f87bdf657e71a15d96a297954006fa306b8189cd2348979038d0d` (`receipt-share-card.txt`, 1,319 bytes).
- Harvested event-log hash before sanitization: `sha256:a4175aa23dad626256e9a7dd2c30b1ee82c9a786edd7c35ee547d72540de597b` (`events.jsonl`).

Raw event logs can contain response content, tool schemas, provider IDs, timing, selected headers, and detector evidence. Do not post raw event logs. This card contains only aggregate rows and artifact hashes.

## Receipt Headline

| Ledger | Value | Meaning |
| --- | ---: | --- |
| Spent | `$1.713128` | Provider-priced spend observed by the run. |
| Money loss | `$0.000371` | Bill-bounded loss tied to observed spend or charge evidence. It rounds to `$0.00` in the headline. |
| Time loss | `~0s` | Time ledger impact; it is not added to dollars. |
| Provider-recognized | `$0.000371` | Amount recognized by provider policy or provider-origin charge evidence in this run. |
| Recognition gap | `$0.000000` | Bill-bounded money loss minus provider-recognized. |

## Invoice-Check Exposure

Exposure is shown separately from money loss and recognition gap.

| Exposure | Count | Amount | Guidance |
| --- | ---: | ---: | --- |
| `cache_discount_at_risk` | 19 | `$2.508918` | verify your invoice |

## Provider Aggregates

Provider names are shown because the aggregate rows are recoverable from stored artifacts. These rows are run-scoped and should not be read as a provider ranking.

| Provider | Calls | Provider-error events | Observed spend |
| --- | ---: | ---: | ---: |
| OpenAI | 70 | 0 | `$0.002020` |
| Gemini | 5 | 1 | `$0.000438` |
| Anthropic | 32 | 2 | `$1.710670` |

## Signal Aggregates

| Signal or exposure | Failure class | Evidence grade | Count | Primary ledger | Money loss | Provider-recognized | Recognition gap |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: |
| `TRUNCATED` | `truncation` | `refundable_candidate` | 1 | bill-bounded money loss | `$0.000371` | `$0.000371` | `$0.000000` |
| `ANTHROPIC_TOKEN_CROSSCHECK` | `anthropic_token_crosscheck` | `triage_only` | 12 | triage-only | `$0.000000` | `$0.000000` | `$0.000000` |
| `PROVIDER_DOWNTIME` | `downtime` | `triage_only` | 1 | triage-only | `$0.000000` | `$0.000000` | `$0.000000` |
| `CACHE_DISCOUNT_AT_RISK` | `cache_discount_at_risk` | `invoice-check exposure` | 19 | exposure | not included | not included | not included |

## Coverage Aggregate

- Suite version: `inferock-coverage-suite-v1`.
- Coverage summary method: `inferock-bench-coverage-summary-v1`.
- Surfaces watched: 12 of 13.
- Signals reported by coverage: 32.
- Receipt failures/signals including exposure and provider-error rows: 33.
- Not-openable surfaces: 1.
- Unopened surface: `Drift / regression` (`drift_regression`) because the drift canary baseline was still collecting, 0 of 3 prior baseline runs completed before current run.

## Generator And Task Mix

The stored evidence contains ordinary built-in coverage tasks plus normal local traffic through the proxy. The public card intentionally avoids raw prompt text and raw responses.

| Mix item | Calls |
| --- | ---: |
| OpenAI traffic | 70 |
| Gemini traffic | 5 |
| Anthropic traffic | 32 |
| Drift canary calls observed for baseline collection | 50 |
| Cache-integrity exposure signals | 19 |
| Anthropic output-token cross-check signals | 12 |
| Provider-error events | 3 |

## Sanitization

This public card does not include prompts, outputs, provider keys, local bench keys, provider request IDs, host paths, raw traces, customer identifiers, or raw event rows.

Provider and local bench keys were not used for re-rendering. The re-render used the harvested event store only, with provider-key environment variables omitted from the receipt-rendering process.

## What to read next

- [Hard questions](hard-questions.md) for the limits on interpreting this run.
- [Coverage test methodology](coverage-test-methodology.md) for how coverage states are opened without manufacturing failures.
- [Asset provenance](../assets/PROVENANCE.md) for the masking and no-mock trail behind the public images.
- [Public run card: 2026-07-10](public-run-2026-07-10.md) for run15 and the cumulative-store reconciliation.
- [Historical 2026-07-06 run card](public-run-2026-07-06.md) for the pre-exposure-split artifact.
