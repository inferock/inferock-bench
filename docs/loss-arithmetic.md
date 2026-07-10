# Paid-Loss Arithmetic

This page is the plain-English version of the receipt math. The rulebook lives in [The Inferock Standard](../spec/standard.md#definitions), the [separate money and time ledgers](../spec/standard.md#separate-money-and-time-ledgers), the [time-loss rules](../spec/standard.md#time-loss-rules), and the [signal ledger handling](../spec/signals.md#required-ledger-handling).

Every receipt row carries its `computation_trace`: method id and version, standard version, priced inputs, formula, outputs, and source references. That trace is what lets the receipt show the number without asking you to trust a dashboard total.

## 1. Failed Priced Calls Get A Call-Cost Floor

If a priced call fails the standard's delivery requirement, the money loss starts at the actual charges for that failed call:

`loss(call) = Σ(token counts × pinned registry rates)`

If a rate is stored per million tokens, the trace normalizes the unit before multiplying. The floor is refund-shaped: it is the spend tied to the failed priced call. There is no punitive multiplier, fallback multiplier, or invented replacement price; that multiplier/fallback path was killed on 2026-07-05.

## 2. Delivered-But-Overbilled Calls Use A Delta

When the call delivered output but charge evidence says the billed count exceeded the visible recount, the loss is only the phantom-token delta:

`loss = (billed_output_tokens - recounted_visible_tokens) × output_rate`

The delivered call does not get a whole-call floor. The shipped example from the 2026-07-10 OpenAI `gpt-5.5` run is 64 `token_recount_mismatch` calls with `$0.011670` total money loss. Those calls delivered, so the receipt counted only the overbilled visible-output tokens, not the full calls.

## 3. Retry Amplification Counts Extra Provider-Fault Attempts

Retry amplification is the sum of the non-final provider-fault attempts' own billed costs:

`loss = Σ(cost(non-final provider-fault attempt))`

The final delivered attempt never counts as retry loss. SDK-default or customer app retries are not provider-fault by themselves; the retry row needs provider-fault evidence such as overload, 5xx/timeout class, retry guidance, or the shipped chain grouping evidence.

## 4. One Call Gets One Floor

One call can fire several signals, but it gets only one whole-call floor. The persisted ledger uses a row-lock/supersession rule so a billed-empty, downtime, security, refusal, or retry-related signal cannot double-count the same failed attempt. Exact overcharge deltas can still stack when they are separate charge-evidenced deltas rather than a second floor.

## 5. What Stays Out Of Money Loss

Cache discount at risk is exposure, not headline money loss:

`exposure = cache_read_tokens × (full_input_rate - cache_read_rate)`

It renders as `cache discount at risk — verify your invoice: $X` and is never summed into money loss or recognition gap without charge evidence.

Latency and downtime live in the time ledger. Latency uses:

`time_loss_ms = max(0, observed_total_ms - acceptable_total_ms)`

Downtime uses clustered provider-owned failure windows. Any dollar-at-editable-rate translation is secondary context; it is not added to the money headline. `triage_only` and `pricing_unknown` rows add `$0` and stay labeled, with `pricing_unknown` rendered as "pricing unknown — add model price."

## 6. The Consequence

`money loss = Σ(paid-loss terms) ≤ observed provider spend`

The paid-loss terms are call-cost floors, charge-evidenced deltas, and retry extra-attempt spend. Provider-recognized recovery is separate, so:

`recognition gap = money loss - provider-recognized`

Because every paid-loss term is anchored to observed billed spend or charge evidence, the percent-of-spend line shipping in `0.1.10` inherits the same `≤100%` bound.

## What Default-Tier Provider Contracts Actually Promise

This table uses only the existing SLA honesty/source record and row research exhibits summarized in the public [disclosure annex](../spec/disclosure-annex.md#availability-service-level-objective-parity), plus the public provider-scope notes in the [README](../README.md#adding-a-provider). "Default tier" means standard first-party API or pinned router use, not a cloud-resold SLA, enterprise addendum, or private contract.

| Provider | Uptime commitment | Failure / credit policy | Rate-limit tiers |
| --- | --- | --- | --- |
| OpenAI | Standard first-party API: no public service-level objective in the source record; priority-tier 99.9% was only partially verified because the page was blocked. Source record retrieval: 2026-07-01; terms page cited by the row exhibit: [OpenAI Business Terms](https://openai.com/policies/may-2025-business-terms/). | Standard API fees non-refundable in the source record; failed-call billing for 5xx, timeout, and partial-stream responses is not documented in the public source record, so any broader failed-call credit rule is `UNVERIFIED`. | Rate-limit tiers define usage limits, not uptime promises. Under the [provider-downtime rule](../spec/signals.md#provider_downtime), a generic 429 is customer/rate/quota unless provider-owned capacity evidence makes it provider fault. |
| Anthropic | Standard first-party API: no public service-level objective in the source record; commercial terms are recorded as "AS IS." Source record retrieval: 2026-07-01; terms page cited by the row exhibit: [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms). | Pre-output refusal non-billing is documented; first-party availability/latency credits are not in the source record. Post-200 stream `event:error` is documented, but a default refundable credit policy for those failures is `UNVERIFIED`. | Rate-limit and acceleration limits define admission limits. A 429 remains excluded from provider-fault money loss unless the event carries provider-owned capacity evidence under the 429 ownership rule. |
| OpenRouter | Default pinned OpenRouter use has measured endpoint and pricing gates, but the repo artifacts do not contain a default uptime SLA terms-page retrieval. Uptime commitment is therefore `UNVERIFIED` and treated as no provider-recognized credit basis unless the receipt carries a real contract. | The verified row evidence is OpenRouter's official zero-completion announcement: zero-output responses are charged `$0`; the broader terms page and retrieval date are `UNVERIFIED` in repo artifacts. Partial, truncated, schema-invalid, drifted, or mis-billed responses are not sourced here as refunded. | Routing, provider sorting, and rate-limit controls define limits or routing behavior, not a promise that within-tier throttling is provider-fault loss. Upstream or router 429s follow the same ownership rule: no provider-fault loss without provider-owned capacity evidence. |

the recognition gap exists because default tiers promise ~nothing refundable while the standard measures the loss anyway.
