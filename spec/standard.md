# The Inferock Standard

Version: v0.1.0

Status: Draft

License: CC-BY-4.0, as provided in `spec/LICENSE`.

Note: The plain-English intro layer below is non-normative. The versioned rules begin at [Purpose](#purpose).

Draft means the standard is pre-ratification and open to evidence-backed issue reports; it does not mean rules can silently change inside a receipt. Public claims must cite the exact standard version and changelog entry that produced them.

Read this as the rulebook behind a receipt, not as a provider refund policy. The quickest path is to understand the receipt headline - `spent $X · money loss $Y · time loss Z · invoice-check exposure $E` - then follow the evidence posture and ledger rules that keep refund claims and invoice-check exposure separate from measured loss.

| If you need to know | Start with |
| --- | --- |
| What loss means under the standard | [Definitions](#definitions) and [Failure Taxonomy](#failure-taxonomy) |
| Why provider-recognized recovery can stay at `$0` | [Evidence Postures](#evidence-postures) and [Separate Money And Time Ledgers](#separate-money-and-time-ledgers) |
| Which denominator makes a claim honest | [Denominator Rules](#denominator-rules) |
| How versions stay accountable | [Versioning](#versioning) and [CHANGELOG.md](CHANGELOG.md) |

## Plain-English Reader Guide

This non-normative layer is the quick map for readers who need the meaning before the rules.

> **TL;DR**
>
> - The standard assigns each AI provider failure to bill-bounded money loss, time loss, invoice-check exposure, or review-only evidence under Inferock rules.
> - Every failed, priced, non-delivering call tied to observed spend or charge evidence gets at least the priced cost of that call under Inferock rules.
> - Receipts lead with four plain facts: provider spend, bill-bounded money loss, time loss, and invoice-check exposure.
> - Provider-recognized recovery, recognition gap, and invoice-check exposure detail lines stay separate below the headline.
> - Evidence grades decide whether a row is ready to dispute or watch-only.

How to read this document: Most readers should start with [Failure Taxonomy](#failure-taxonomy) and [Evidence Postures](#evidence-postures); those sections explain what can fail and how strong the evidence is. Integrators should pair [Definitions](#definitions) with [`spec/event-schema.md`](event-schema.md) for the canonical event shape. Disputants should read [Liability Attribution](#liability-attribution) and [Separate Money And Time Ledgers](#separate-money-and-time-ledgers) before turning a receipt into a provider claim.

### Table of Contents

- [Purpose](#purpose)
- [Measurement Invariants](#measurement-invariants)
- [Definitions](#definitions)
- [Failure Taxonomy](#failure-taxonomy)
- [Evidence Postures](#evidence-postures)
- [Liability Attribution](#liability-attribution)
- [Separate Money And Time Ledgers](#separate-money-and-time-ledgers)
- [Denominator Rules](#denominator-rules)
- [Time-Loss Rules](#time-loss-rules)
- [Versioning](#versioning)

### Illustrative Example

This is an illustrative example, not a measured claim. A response is billed at `$0.0042`, ends with a provider terminal truncation reason, and returns unusable partial JSON for a declared JSON task. The detector classifies it as an output integrity failure with known pricing. Inferock-standard loss is at least `$0.0042`: the priced cost of the non-delivering call. If current provider policy does not recognize that truncation as refundable, provider-recognized recoverable loss is `$0.00`. The recognition gap is `$0.0042`; the evidence grade decides whether the row is ready to dispute or watch-only.

## Purpose

The Inferock Standard defines how Inferock measures AI provider failure, grades evidence, assigns liability, and separates provider-recognized recoverable loss from loss that providers do not currently recognize. It is the benchmark rule set for `inferock-bench`, `@inferock/measure`, and the receipt.

This standard is independent of provider refund policies. Provider policy determines whether a provider currently recognizes a charge as refundable or an outage as creditable. The Inferock Standard determines whether the customer experienced measurable loss, how that loss is evidenced, and where it belongs in the money ledger or the time-loss ledger.

## Measurement Invariants

Every measured number must originate from a real provider call measured by the real detector path. Dashboard, report, benchmark, and receipt numbers must never come from seeded rows, hand-written rows, hardcoded detector outputs, fabricated trends, or manufactured demonstration data.

Live measurement uses normal customer traffic. The benchmark must not provoke failures for the sake of producing a signal. It must not force truncation with tiny token limits, trigger refusals with adversarial prompts, craft malformed inputs to create broken output, reuse request identifiers to manufacture duplicates, or use live fault injection to populate a report.

Fixtures are allowed only for tests and static specification examples. They must be isolated from customer-facing measurement data and labeled as fixtures, not measured claims.

## Definitions

A provider call is one request to a supported provider surface. The public bench app currently ships OpenAI, Anthropic, Gemini, and pinned OpenRouter OpenAI-compatible provider adapters; OpenRouter support is measured only when requested pinning, served endpoint metadata, and cited pricing evidence match the current pinned endpoint set. The canonical event parser also accepts additional provider identifiers for compatible records. The call may include retries or attempts when those attempts are captured as part of the event.

A canonical event is the measured record for a provider call. It carries request identity, response identity, usage, timing, attempts, and optional evidence surfaces. `spec/event-schema.md` defines the as-built v1 and v2 event fields.

A signal is a detector output that describes a possible failure or evidence condition. A signal carries a code, detector name, evidence grade, status, value kind, liability party, pricing status, and evidence object. `spec/signals.md` defines the public v0.1.0 signal set.

A failure is a provider-call outcome that can be tied to a failure class under this standard. A failure can be provider-recognized recoverable, unrecognized loss, triage-only evidence, or a provider-recognized `$0` evidence overlay.

Provider-recognized recoverable loss is a dollar amount or creditable downtime duration that sits inside a category the provider currently recognizes, can credit, or has an evidence standard for recognizing. The current implementation stores qualifying dollars as `providerRecoverableLossUsd`; time-loss receipts also store provider-recognized milliseconds when a provider SLA applies.

Unrecognized loss is measured customer loss under The Inferock Standard that providers do not currently recognize as refundable or creditable. Latency time loss, downtime duration without a creditable provider SLA, retry amplification without per-request billing reconciliation, and other not-yet-recognized classes belong here unless a provider credit rule applies.

For every priced non-delivering call, Inferock-standard loss includes at least the call's own priced cost. Measure-specific charge-evidenced overcharge deltas and induced retry spend can increase or refine that amount, but headline money-native standard-loss is bill-bounded by observed provider spend for the run. If model pricing is missing, the receipt must label `pricing_unknown — add model price` rather than treating the loss as zero.

The recognition gap is the difference between total customer loss under The Inferock Standard and provider-recognized recoverable loss within the same unit. The gap is a first-class metric and must not be hidden by collapsing recognized and unrecognized values.

An exposure is a counterfactual or invoice-verification amount that the standard preserves as evidence but does not include in headline standard-loss or recognition gap. `CACHE_DISCOUNT_AT_RISK` is the launch exposure class: the receipt reports `cache discount at risk — verify your invoice: $X` separately when usage and pricing imply a discount could be at risk, and the customer should verify the invoice before treating it as observed loss.

The receipt is the shareable artifact for an individual benchmark run or report. Receipt schema v2 reports measured evidence under this standard and preserves provider-recognized and unrecognized splits while keeping money totals and time totals as separate headlines.

## Failure Taxonomy

The v0.1.0 public taxonomy includes these launch-safe classes:

| Class | Public scope |
| --- | --- |
| Output integrity | Declared JSON or schema failures, provider terminal truncation, and billed-empty output where safety, refusal, tool-call, and hidden-output guards do not explain the empty visible response. |
| Refusal and content-filter billing | Provider-native refusal or content-filter evidence on expected completions, including the Anthropic pre-output refusal billing invariant when observed charge evidence proves billing. |
| Billing integrity | OpenAI visible-output token recount overcharge candidates, pricing-unknown evidence preservation, cache charge reconciliation, cache-discount invoice-check exposure, and duplicate request-identifier bill-bounded loss surfacing. |
| Availability and downtime | Clustered provider-owned 5xx, timeout, overloaded, and capacity evidence where the detector can distinguish provider ownership from ambiguous transport or customer-owned throttling. Time is primary; provider credits are capped by the applicable SLA and spend terms. |
| Latency and time loss | Disclosed latency service-level objective breaches, real elapsed milliseconds, and excess wait evidence. Time is primary; dollar recovery requires an explicit credit basis and dollar translation requires an editable customer rate. |
| Security/governance | Exact leaked-secret real-loss signals on priced calls, plus evidence-only provider safety/moderation context when no loss event fires. |
| Factuality | Customer-provided known-answer contradictions and built Anthropic cited-text contradiction checks, both evidence-gated and reported as unrecognized standard loss. |

Drift remains a deferred/triage public class. Security and factuality are launch-safe only for the evidence-gated real-loss signals above; broader prompt-injection, PII/PAN, generic hallucination, retrieval-mismatch, and judge-based quality claims remain out of scope.

## Evidence Postures

Each signal must carry a public evidence posture:

| Posture | Meaning |
| --- | --- |
| `refundable_candidate` | Objective evidence exists for a provider-recognized category. It contributes provider-recognized recoverable dollars only when the signal status is `candidate` or `accepted`, `creditCandidate` is true, pricing is known, and `providerRecoverableLossUsd` is present. |
| `triage_only` | Evidence exists for review, support, investigation, or future reconciliation, but the signal does not contribute provider-recognized recoverable dollars in v0.1.0. |
| `provider_recognized_0_evidence_only` | The row is evidence overlay or impact context with no provider-recognized recoverable dollars. It must not add to provider-recognized recoverable dollars or measured-call denominators for failure rows. The as-built signal grade is usually `triage_only`; Inferock-standard loss still uses the priced call-cost floor when the call fails the standard. |
| `pricing_unknown` | The evidence is preserved, but price lookup is missing or partial. The status is `pricing_unknown`, the signal contributes no dollar figure until the model price is added, and the report must show the pricing limitation instead of silently treating unknown price as zero loss. |

The implementation enum also contains `not_applicable`. It is reserved by the as-built signal model and is not a launch evidence posture for v0.1.0 public loss claims.

## Liability Attribution

Every signal carries one liability party:

| Liability party | Rule |
| --- | --- |
| `provider` | Provider-side evidence supports provider ownership, such as a provider-owned status code, terminal reason, provider-native safety evidence, or provider-origin charge evidence. |
| `customer` | The evidence points to customer-caused behavior. Customer-owned causes must not become provider-recognized recoverable loss. |
| `shared` | The evidence supports a mixed cause or a chain involving both provider and customer behavior. |
| `unknown` | The detector has real evidence but cannot assign ownership without overclaiming. |
| `not_applicable` | The row is not a liability-bearing loss claim. |

Unknown or shared liability may still be useful evidence. It must not be promoted into provider-recognized recoverable dollars without the additional evidence required by the relevant signal.

## Separate Money And Time Ledgers

The standard uses separate money and time ledgers. Reports and receipts must show a money headline and a time-loss headline. They must never sum dollars and time into one total.

The money ledger contains bill-bounded dollar-native losses: provider-recognized recoverable dollars, unrecognized standard-loss dollars, charge-evidenced overcharge deltas, call-cost floors, and retry extra-attempt spend. A dollar-native signal enters provider-recognized recovery only when it is a qualifying refundable candidate under `spec/signals.md`, has known pricing or observed charge evidence as required by the signal, and carries `providerRecoverableLossUsd`.

The time-loss ledger contains real milliseconds. Latency and downtime are time-primary classes. Their rows may carry editable dollar translations, but those translations are secondary and must not be added to the money headline. For latency without configured provider latency credit basis, the provider-recognized line is `$0 / 0s` or "no configured provider latency credit basis for this receipt" depending on service-tier/contract evidence.

Unrecognized standard loss remains first-class in both ledgers. For priced non-delivering calls outside latency/downtime, the money ledger includes at least the call-cost floor. The built retry-chain refinement adds provider-fault extra-attempt costs. Unsupported duplicate charge concerns can add precision or stay provider-recognized `$0` until provider billing evidence exists.

Exposure is not a third loss ledger. It is a separately labeled class for counterfactual amounts that require invoice verification before they can be treated as observed money loss. Exposure lines are reported beside the receipt, never summed into money-native standard-loss, provider-recognized recovery, or recognition gap. The launch exposure class is `cache_discount_at_risk` with guidance `verify your invoice`.

The recognition gap is computed within each unit. Reports must show provider-recognized recovery, Inferock-standard loss, and the gap separately for money and for time. A dollar amount from the unrecognized ledger must never be added to provider-recognized recoverable loss merely to make a larger recoverable number.

## Denominator Rules

The call denominator is total measured provider calls from normal traffic. It is not failed calls, signal rows, retries alone, screenshots, fixture rows, or drift replay rows.

The spend denominator is total measured provider spend for calls whose pricing or provider-origin charge evidence is known. Calls with `pricing_unknown` or `partial` pricing remain in call counts and evidence views, but their dollar contribution must be labeled unknown rather than estimated.

Failure rates must use total measured calls as the denominator. Dollar impact rates must use total measured spend where spend is known. Reports must preserve the count of calls with unknown pricing so the denominator limitation is visible.

No denominator may include manufactured failure traffic or static examples.

## Time-Loss Rules

Time loss uses real milliseconds captured by the canonical event timing fields and clustered provider-failure windows. It must not use invented latency, simulated delay, guessed queue time, or benchmark-only synthetic timing.

The standard time-loss rules are:

| Rule | Measurement |
| --- | --- |
| Latency excess | `max(0, observed_total_ms - acceptable_total_ms)`. The active acceptable threshold is a visible, editable customer proposal. |
| Downtime duration | Clustered organic provider-failure window duration: at least two provider-owned logical-operation failures and provider-fault rate above the applicable provider SLA threshold, or above the Inferock standard-defined default of >5% when no provider threshold applies, over rolling five-minute windows. The default is medium-confidence outside provider-specific SLAs and is not provider-accepted credit proof. |
| Retry-chain refinement | Built method: sum provider-billed/list-price costs for non-final provider-fault retry attempts. Grade A uses `x-stainless-retry-count`; Grade B uses body-hash/time-window fallback. Provider-recognized retry loss is `$0`; the formula is Inferock's floor-conservative construction, not an externally ratified LLM retry-cost standard. |

Latency time loss stores exact milliseconds in the computation trace and renders approximate labels only for display: `<60s` as `~Ns`, `60s-60min` as `~M.M min`, and `>=60min` as `~H.H hr`.

Downtime identification collapses retries to logical operations before computing failure rates. It excludes `ambiguous_transport` evidence, does not infer an outage from one failed call, claims the floor duration from first provider failure to last provider failure, and stores the last-good to first-good envelope as uncertainty. Sparse traffic lowers the evidence grade. Provider status-feed corroboration may raise an identified window's grade, but it must not create a downtime window by itself.

Time may be translated to dollars only with an editable customer rate. Inferock may propose a sourced default rate, but the rate remains visible and editable. Every dollarized-time figure must carry the rate, the source label, and the customer declaration or proposal state.

Time loss remains real loss even when it is not provider-recognized recoverable. A time-loss dollarization must not be presented as provider-recognized recoverable unless an explicit provider credit rule supports it.

## Versioning

This file defines The Inferock Standard v0.1.0. Changes to evidence posture, ledger placement, denominator rules, or time-loss rules require a new changelog entry in `spec/CHANGELOG.md`.

## What to read next

- [Public Signal Semantics](signals.md) for the launch-safe signal set and signal-specific ledger handling.
- [Canonical Event Schema](event-schema.md) for the event fields that make receipt rows reproducible.
- [Provider Disclosure Requirements Annex](disclosure-annex.md) for the provider-side disclosures needed to move evidence toward recognition.
