<!-- GENERATED VIEW: source of truth is packages/measure/src/sla-defaults.ts -->

# SLA Defaults

Standard version: `sla-defaults-2026-07-03-user-approved`

These defaults are part of the Inferock Standard. They define standard loss owed by the standard, not a promise that the provider has already recognized or will automatically pay it.

Use this generated view when you need the reader-facing latency thresholds, time-value default, and evidence-grade label that match `packages/measure/src/sla-defaults.ts`. The source note and labels below are SSOT-pinned; edit the source of truth first if a default changes.

| Need | Section |
| --- | --- |
| Latency threshold math | [Latency Segments](#latency-segments) |
| Default time-value assumption | [Time Value](#time-value) |
| Evidence grade label | [Evidence Grade](#evidence-grade) |

## Latency Segments

| Segment | Good first result | Acceptable first result | Good throughput | Acceptable throughput | Acceptable total formula |
|---|---:|---:|---:|---:|---|
| `interactive_streaming_non_reasoning` | 1,000 ms | 10,000 ms | 50 tokens/sec (20 ms/output token) | 44 tokens/sec (23 ms/output token) | `10,000 ms + outputTokens * 23 ms` |
| `interactive_streaming_reasoning` | 10,000 ms | 500,000 ms | 50 tokens/sec (20 ms/output token) | 44 tokens/sec (23 ms/output token) | `500,000 ms + outputTokens * 23 ms` |
| `batch_non_reasoning` | 30,000 ms | 3,600,000 ms | 50 tokens/sec (20 ms/output token) | 44 tokens/sec (23 ms/output token) | `3,600,000 ms + outputTokens * 23 ms` |
| `batch_reasoning` | 500,000 ms | 3,600,000 ms | 50 tokens/sec (20 ms/output token) | 44 tokens/sec (23 ms/output token) | `3,600,000 ms + outputTokens * 23 ms` |

Latency loss uses excess-only time math. Time is the primary quantifier for latency:

`excess_ms = max(0, observed_total_ms - acceptable_total_ms)`

`time_lost_ms = excess_ms`

The editable dollar translation is secondary and must never replace the time value:

`dollar_translation_usd = time_lost_ms * 92 / 3,600,000`

The persisted secondary dollar field remains present for compatibility and uses the same excess-only basis:

`standard_loss_usd = excess_ms * 92 / 3,600,000`

Receipts render time loss with an approximate display label while preserving exact milliseconds in the computation trace:

- `<60s`: `~Ns`
- `60s-60min`: `~M.M min`
- `>=60min`: `~H.H hr`

## Time Value

<!-- ssot-fact:sla.time_value_rate.default_usd_per_hour -->
Default rate: `$92/hour`.

Source note: This default is the Inferock proposed time-value assumption, computed from BLS software-developer wage data and BLS private-industry benefit share (`BLS-OOH`, `BLS-OEWS-2080`, `BLS-ECEC`). It is not customer-confirmed and not provider-recognized. Receipts must preserve the override key `time_value_usd_per_hour` so customers can replace it with their own loaded rate or set it to zero.

Label: `Inferock DEFAULT ASSUMPTION - not customer-confirmed, not provider-recognized loss (default -- override)`.

## Why time is dollarized — the founder rationale (recorded 2026-07)

User-directed 2026-07-05. The plain-English rationale is the cheap-labor drain analogy: a buyer may choose a cheaper worker at `$20/hour` over a premium worker at `$50/hour`, but if the cheap worker stretches a one-hour job across three hours, the buyer pays `$60` and loses the time the premium path would have saved. The loss is the drain on throughput and blocked work, not the sticker price.

Latency follows the same logic. A slow provider call can look cheap in token spend while still costing the customer more in wasted time than a faster, more expensive route would have. This is why the standard translates excess latency into editable dollar context instead of treating a slow-but-completed call as cheap and fine. The time drain can exceed provider spend when translated at the customer's rate, but that translation remains secondary context; it is not added to the bill-bounded money-loss headline.

The calculation stays defensible because two customer-confirmable knobs carry the judgment:

1. The acceptable threshold: what the customer agrees should have been fast enough for that segment, below which there is no time drain.
2. The time-value rate: `$92/hour` is the default proposed loaded-rate assumption, but receipts preserve `time_value_usd_per_hour` so the customer can confirm their own rate or set it to zero.

The standard proposes the threshold and dollarized time lens; the customer confirms or overrides the assumptions. Once confirmed, the number is the customer's time-value loss, not an invented provider charge.

Provider-recognized loss for first-party latency defaults to no configured provider latency credit basis unless the receipt carries supported service-tier/contract context or a real published provider SLA and breach policy applies. The full time loss remains the headline time-loss value, the dollar translation remains editable secondary context, and the provider-recognized gap is first-class.

## Evidence Grade

The latency default emits evidence grade `unrecognized_standard_loss`, labeled `standard-defined loss, provider-unrecognized (owed by Inferock Standard; not yet provider-recognized)`.

Every computed time-loss or dollar-translation signal must include a machine-readable computation trace with method id/version, inputs, intermediate steps, outputs, and SSOT source refs.

## What to read next

- [The Inferock Standard](standard.md#time-loss-rules) for time-loss ledger rules.
- [Coverage test methodology](../docs/coverage-test-methodology.md) for how latency/token evidence is opened in normal runs.
- [Pricing methodology](../docs/pricing-methodology.md) for the no-silent-zero pricing rule.
