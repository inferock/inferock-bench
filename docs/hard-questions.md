# Hard Questions

This page answers the questions a skeptical reader should ask before trusting an `inferock-bench` receipt. The short version: the receipt is evidence, not authority. It leads with spent dollars, bill-bounded money loss, time loss, and invoice-check exposure; then it keeps provider-recognized recovery, bill-bounded recognition gap, and invoice-check exposure detail separate so arguments happen against concrete rows instead of slogans.

Read this if you are checking the benchmark method, receipt math, claim boundaries, or publication model. The questions below are ordered to keep the receipt math first and the operating boundaries visible before any deeper method argument.

| If you are checking | Start with |
| --- | --- |
| The receipt headline and invoice-check exposure detail line | [Q1](#q1-can-the-headline-money-loss-exceed-my-provider-bill), [Q5](#q5-why-count-a-whole-call-as-loss-if-the-provider-returned-some-tokens), [Q6](#q6-are-you-accusing-providers-of-overbilling), [Q12](#q12-how-are-cache-discounts-and-duplicate-request-ids-reported) |
| Standard authorship and versioning | [Q2](#q2-why-should-anyone-accept-a-standard-written-by-the-company-that-built-the-benchmark), [Q3](#q3-what-does-v021-draft-mean-for-receipt-math), [Q10](#q10-how-are-standard-changes-versioned) |
| Public-run and provider coverage | [Q4](#q4-what-does-a-public-run-show), [Q8](#q8-which-provider-surfaces-are-measured-today), [Q13](#q13-what-does-the-public-mirror-represent) |
| Trust and sharing boundaries | [Q7](#q7-how-should-readers-treat-third-party-statistics-cited-for-context), [Q9](#q9-is-inferock-bench-open-source), [Q14](#q14-what-should-i-share-instead-of-raw-event-logs) |

## Q1. Can the headline money loss exceed my provider bill?

From the exposure-split presentation forward, the receipt headline is `spent $X · money loss $Y · time loss Z · invoice-check exposure $E`, and headline money loss is bill-bounded. Counterfactual or verify-against-invoice amounts get their own fused-label invoice-check exposure element and detail line instead of being summed into standard-loss or recognition gap.

For the exact formulas, see [Paid-loss arithmetic](loss-arithmetic.md).

The public 2026-07-10 cumulative card shows the current 0.2.3 read: `$7.15` spent, `$0.03` headline money loss (stored exact `$0.026464`), `~2.9 min` time loss, and `$16.80` cache-discount invoice-check exposure labeled "verify your invoice." That card is an issue-weighted adaptive traffic mix; failures/signals are receipt findings rather than unique calls, and invoice-check exposure is separate from booked money loss. The older 2026-07-06 card remains published as a historical pre-split artifact.

## Q2. Why should anyone accept a standard written by the company that built the benchmark?

You should not accept it by authority. The defense is the published [rulebook](../spec/standard.md#purpose), [versioned changelog](../spec/CHANGELOG.md), inspectable detector code, evidence grades, and run-scoped receipts that separate provider-recognized recovery from Inferock-standard loss. Providers still define what they currently credit; Inferock defines the customer-loss ledger it applies to local evidence.

## Q3. What does `v0.2.1 Draft` mean for receipt math?

Draft means pre-ratification and open to evidence-backed issue reports. It does not mean a receipt can silently change rules. Public claims should cite the exact [standard version](../spec/standard.md#versioning) and changelog entry that produced them, and later rule changes should not rewrite old receipts.

## Q4. What does a public run show?

A public run is meaningful as a real run artifact, not as an industry incidence estimate. It proves the local benchmark can produce a run-scoped receipt from normal measured traffic across configured providers. Users should run the same versioned suite on their own traffic; any public run card should show denominator, task mix, provider scope, and coverage debt under the [Denominator Rules](../spec/standard.md#denominator-rules). Normal usage does not mean accidental traffic only; it means ordinary tasks that carry measurement preconditions while failure manufacturing is forbidden.

## Q5. Why count a whole call as loss if the provider returned some tokens?

The call-cost floor applies only when a priced call fails the standard's delivery requirement, such as unusable structured output, truncation, billed-empty output without an accepted explanation, or another launch-safe non-delivery class. It is not automatically provider-recognized. Exact overcharge deltas can refine the amount, and provider-recognized remains `$0` unless provider policy or charge evidence supports recovery. See [Failure Taxonomy](../spec/standard.md#failure-taxonomy) and [Liability Attribution](../spec/standard.md#liability-attribution).

## Q6. Are you accusing providers of overbilling?

Not from an exposure row or an unrecognized bill-bounded money-loss row. The receipt keeps spent dollars, bill-bounded money loss, time loss, provider-recognized recovery, recognition gap, and invoice-check exposure separate. "Overcharge" should be reserved for provider-recognized or invoice-reconciled deltas; otherwise the correct words are "money loss," "recognition gap," or "exposure - verify your invoice." The ledger rule is in [Separate Money And Time Ledgers](../spec/standard.md#separate-money-and-time-ledgers).

## Q6a. Can I use a receipt to dispute an API bill or ask for a refund?

Use it as evidence, not as a verdict. A compact receipt can show the calls the bench observed, measured token usage, cost, failure, retry, timing, evidence grade, spent dollars, bill-bounded money loss, time loss, and invoice-check exposure. Provider-recognized recovery remains separate because the provider or invoice reconciliation still decides what it will credit.

## Q7. How should readers treat third-party statistics cited for context?

Vaudit is context for why independent billing verification matters; it is not evidence for an `inferock-bench` receipt. The README labels the refund-rate detail as not independently verified. A receipt stands or falls on local event evidence, pricing, detector output, and computation traces under [Measurement Invariants](../spec/standard.md#measurement-invariants).

## Q8. Which provider surfaces are measured today?

Gemini is a supported public bench provider for local proxying, receipts, canonical events, pricing, safety/refusal evidence, schema evidence where captured, and input/countTokens evidence. OpenRouter is supported through the pinned OpenAI-compatible endpoint plane only: endpoint pins, router metadata, served-host evidence, and cited endpoint pricing must match before OpenRouter traffic is priced as measured support. Provider-specific checks stay provider-specific: OpenAI visible-output recount is OpenAI-only, Anthropic token/citation checks are Anthropic-only, Gemini countTokens evidence is input-recount evidence only, and OpenRouter does not turn all router models into measured support. See [Public Signal Semantics](../spec/signals.md).

## Q9. Is `inferock-bench` open source?

Not OSI open source: the local CLI app is source-available under FSL-1.1-ALv2 with two-year Apache-2.0 conversion. Its source is published, independently runnable, and methodology-challengeable; `@inferock/measure` is Apache-2.0, and The Inferock Standard/spec are CC-BY-4.0.

## Q10. How are standard changes versioned?

The right behavior is versioned evolution, not silent edits. Standard changes require changelog entries; old receipts should remain tied to the standard version and method version that produced them. The public v0.2.1 standard also does not dollarize broad quality, style, or generic hallucination. Only customer-provided known-answer contradictions, Anthropic cited-text contradictions, and exact leaked-secret real-loss rows are launch-safe, and provider-recognized remains no by default. See [Versioning](../spec/standard.md#versioning) and the [Launch-Safe Signal Index](../spec/signals.md#launch-safe-signal-index).

## Q11. What evidence backs the Anthropic token recount?

Anthropic does not publish a current local tokenizer for Claude 3+ or an independent billed-output recount API. The current method is provider-assisted grade B: it uses Anthropic `messages/count_tokens` on delivered assistant output with runtime calibration, tolerance bands, and provider-recognized `$0` unless separate provider or invoice evidence accepts it. See the Anthropic token caveat in [signals.md](../spec/signals.md#anthropic_token_crosscheck).

## Q12. How are cache discounts and duplicate request IDs reported?

Cache-discount-at-risk is exposure evidence when usage and pricing imply a discount could be at risk; it is reported separately as `cache discount at risk — verify your invoice: $X` and is not summed into headline standard-loss or recognition gap. Duplicate request ID proves repeated gateway identifiers, not provider double-charging, and therefore stays unrecognized until provider billing evidence exists. See [signals.md](../spec/signals.md#cache_discount_at_risk) and [signals.md](../spec/signals.md#duplicate_request_id).

## Q13. What does the public mirror represent?

The GitHub repo is a generated public mirror, not the source-of-truth development repo. That is disclosed because accepting public fixes requires upstream porting; accepted public changes should be credited in commits, NOTICE, or changelog. This is a governance limitation, not hidden independence.

## Q14. What should I share instead of raw event logs?

Do not post raw `events.jsonl`. Share compact receipts or sanitized run facts; events can contain response content and tool schemas even though provider keys are not stored. The local/network boundary is documented in [What leaves your machine](what-leaves-your-machine.md).

## What to read next

- [Public run card](public-run-2026-07-10.md) for the current aggregate rows behind the public screenshots.
- [Historical public run card](public-run-2026-07-06.md) for the 2026-07-06 pre-exposure-split aggregate rows.
- [The Inferock Standard](../spec/standard.md) for the rulebook that defines spent, bill-bounded money loss, exposure, provider-recognized recovery, recognition gap, and time loss.
- [What leaves your machine](what-leaves-your-machine.md) before sharing receipts or event-derived evidence.
