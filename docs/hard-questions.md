# Hard Questions

This page answers the questions a skeptical reader should ask before trusting an `inferock-bench` receipt. The short version: the receipt is evidence, not authority. It separates provider spend, Inferock-standard loss, provider-recognized recovery, and recognition gap so arguments happen against concrete rows instead of slogans.

Read this if you are wondering whether the benchmark is fair, legal, or overclaiming. The questions below are ordered to keep the receipt math first and the governance limits visible before any deeper method argument.

| If you are checking | Start with |
| --- | --- |
| The three receipt numbers | [Q1](#q1-how-can-standard-loss-be-462-when-observed-provider-spend-was-only-128), [Q5](#q5-why-count-a-whole-call-as-loss-if-the-provider-returned-some-tokens), [Q6](#q6-are-you-accusing-providers-of-overbilling), [Q12](#q12-are-cache-discounts-and-duplicate-request-ids-real-losses) |
| Whether the standard can be trusted | [Q2](#q2-why-should-anyone-accept-a-standard-written-by-the-benchmark-vendor), [Q3](#q3-is-v010-draft-real-enough-to-compute-dollars), [Q10](#q10-can-inferock-move-the-goalposts-after-providers-criticize-a-result) |
| Public-run and provider-scope limits | [Q4](#q4-is-the-175-call-run-statistically-meaningful), [Q8](#q8-are-gemini-and-openrouter-fully-supported), [Q13](#q13-is-the-public-mirror-hiding-governance-risk) |
| Trust and disclosure boundaries | [Q7](#q7-why-cite-vaudit-if-its-refund-rate-is-not-independently-verified), [Q9](#q9-is-inferock-bench-open-source), [Q14](#q14-can-raw-event-logs-leak-data) |

## Q1. How can standard-loss be `$4.62` when observed provider spend was only `$1.28`?

Because those are different receipt fields. Provider spend is what the run observed as provider cost. Standard-loss is what [The Inferock Standard](../spec/standard.md#definitions) says failed priced calls and standard-defined deltas cost the customer. Provider-recognized recovery is separate under [Separate Money And Time Ledgers](../spec/standard.md#separate-money-and-time-ledgers); in the public 2026-07-06 run it was `$0.00`, so the `$4.62` is a recognition gap, not a provider-admitted refund.

## Q2. Why should anyone accept a standard written by the benchmark vendor?

You should not accept it by authority. The defense is the published [rulebook](../spec/standard.md#purpose), [versioned changelog](../spec/CHANGELOG.md), inspectable detector code, evidence grades, and run-scoped receipts that separate provider-recognized recovery from Inferock-standard loss. Providers still define what they currently credit; Inferock defines the customer-loss ledger it applies to local evidence.

## Q3. Is `v0.1.0 Draft` (the standard's version, separate from the package version) real enough to compute dollars?

Draft means pre-ratification and open to evidence-backed issue reports. It does not mean a receipt can silently change rules. Public claims should cite the exact [standard version](../spec/standard.md#versioning) and changelog entry that produced them, and later rule changes should not rewrite old receipts.

## Q4. Is the 175-call run statistically meaningful?

It is meaningful as a real run artifact, not as an industry incidence estimate. It proves the local benchmark can produce a run-scoped receipt from normal measured traffic across configured providers. Users should run the same versioned suite on their own traffic; any public run card should show denominator, task mix, provider scope, and coverage debt under the [Denominator Rules](../spec/standard.md#denominator-rules). Normal usage does not mean accidental traffic only; it means ordinary tasks that carry measurement preconditions while failure manufacturing is forbidden.

## Q5. Why count a whole call as loss if the provider returned some tokens?

The call-cost floor applies only when a priced call fails the standard's delivery requirement, such as unusable structured output, truncation, billed-empty output without an accepted explanation, or another launch-safe non-delivery class. It is not automatically provider-recognized. Exact overcharge deltas can refine the amount, and provider-recognized remains `$0` unless provider policy or charge evidence supports recovery. See [Failure Taxonomy](../spec/standard.md#failure-taxonomy) and [Liability Attribution](../spec/standard.md#liability-attribution).

## Q6. Are you accusing providers of overbilling?

Not from an unrecognized standard-loss row. The receipt keeps provider spend, provider-recognized recovery, Inferock-standard loss, and recognition gap separate. "Overcharge" should be reserved for provider-recognized or invoice-reconciled deltas; otherwise the correct words are "standard-loss" and "recognition gap." The ledger rule is in [Separate Money And Time Ledgers](../spec/standard.md#separate-money-and-time-ledgers).

## Q6a. Can I use a receipt to dispute an API bill or ask for a refund?

Use it as evidence, not as a verdict. A compact receipt can show the calls the bench observed, the measured token usage, cost, failure, retry, timing, and evidence grade, plus what the Inferock Standard counts as standard-loss. Provider-recognized recovery remains separate because the provider or invoice reconciliation still decides what it will credit.

## Q7. Why cite Vaudit if its refund rate is not independently verified?

Vaudit is context for why independent billing verification matters; it is not evidence for an `inferock-bench` receipt. The README labels the refund-rate detail as not independently verified. A receipt stands or falls on local event evidence, pricing, detector output, and computation traces under [Measurement Invariants](../spec/standard.md#measurement-invariants).

## Q8. Are Gemini and OpenRouter fully supported?

Gemini is a supported public bench provider for local proxying, receipts, canonical events, pricing, safety/refusal evidence, schema evidence where captured, and input/countTokens evidence. OpenRouter is supported through the pinned OpenAI-compatible endpoint plane only: endpoint pins, router metadata, served-host evidence, and cited endpoint pricing must match before OpenRouter traffic is priced as measured support. Provider-specific checks stay provider-specific: OpenAI visible-output recount is OpenAI-only, Anthropic token/citation checks are Anthropic-only, Gemini countTokens evidence is input-recount evidence only, and OpenRouter does not turn all router models into measured support. See [Public Signal Semantics](../spec/signals.md).

## Q9. Is `inferock-bench` open source?

The license stack is mixed. The local CLI app is FSL-1.1-Apache-2.0 with two-year Apache-2.0 conversion, so call it source-available/Fair Source, not OSI open source. `@inferock/measure` is Apache-2.0, and The Inferock Standard/spec are CC-BY-4.0.

## Q10. Can Inferock move the goalposts after providers criticize a result?

The right behavior is versioned evolution, not silent edits. Standard changes require changelog entries; old receipts should remain tied to the standard version and method version that produced them. The public v0.1.0 standard also does not dollarize broad quality, style, or generic hallucination. Only customer-provided known-answer contradictions, Anthropic cited-text contradictions, and exact leaked-secret real-loss rows are launch-safe, and provider-recognized remains no by default. See [Versioning](../spec/standard.md#versioning) and the [Launch-Safe Signal Index](../spec/signals.md#launch-safe-signal-index).

## Q11. Is the Anthropic token recount independent?

No. Anthropic does not publish a current local tokenizer for Claude 3+ or an independent billed-output recount API. The current method is provider-assisted grade B: it uses Anthropic `messages/count_tokens` on delivered assistant output with runtime calibration, tolerance bands, and provider-recognized `$0` unless separate provider or invoice evidence accepts it. See the Anthropic token caveat in [signals.md](../spec/signals.md#anthropic-token-crosscheck).

## Q12. Are cache discounts and duplicate request IDs real losses?

Cache-discount-at-risk is standard-loss evidence when usage and pricing imply a missed discount; provider-recognized remains `$0` until provider-origin charge evidence or invoice reconciliation proves it. Duplicate request ID proves repeated gateway identifiers, not provider double-charging, and therefore stays unrecognized until provider billing evidence exists. See [signals.md](../spec/signals.md#cache-discount-at-risk) and [signals.md](../spec/signals.md#duplicate-request-id).

## Q13. Is the public mirror hiding governance risk?

The GitHub repo is a generated public mirror, not the source-of-truth development repo. That is disclosed because accepting public fixes requires upstream porting; accepted public changes should be credited in commits, NOTICE, or changelog. This is a governance limitation, not hidden independence.

## Q14. Can raw event logs leak data?

Do not post raw `events.jsonl`. Share compact receipts or sanitized run facts; events can contain response content and tool schemas even though provider keys are not stored. The local/network boundary is documented in [What leaves your machine](what-leaves-your-machine.md).

## What to read next

- [Public run card](public-run-2026-07-06.md) for the exact 2026-07-06 aggregate rows behind the public screenshots.
- [The Inferock Standard](../spec/standard.md) for the rulebook that defines standard-loss, provider-recognized recovery, and recognition gap.
- [What leaves your machine](what-leaves-your-machine.md) before sharing receipts or event-derived evidence.
