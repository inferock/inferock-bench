# Measurement Philosophy

This document states what our numbers mean, the rules they obey, the
limits they currently have, and where the project is headed. It exists so
that anyone auditing this benchmark can judge it against what it actually
claims — not against what a benchmark might be imagined to claim.

## The problem

Inference billing is consumption-metered: tokens in, tokens out, dollars
owed. Nothing in that pipeline measures delivery — whether the call
succeeded, answered the question, arrived on time, or was silently served
by a different model. Inference has observability, usage, and cost tools,
but few tools cross-check the actual provider bill per call against
delivery evidence. This project is an attempt to build that in the open.

## The rules every number obeys

1. **Every displayed number traces to a real provider call.** No synthetic
   or simulated claims. If a number cannot be traced to measured evidence,
   it is not shown.
2. **Unknown is shown as unknown.** An unpriced model carries status
   `pricing_unknown` and shows `pricing unknown — add model price`, never `$0`. A surface that was not
   watched is never claimed as clean.
3. **Money loss never exceeds observed spend.** Headline money-loss is
   bill-bounded by construction (enforced per-call and in aggregate since
   v0.1.11).
4. **Observations and interpretations are labeled distinctly.** A measured
   latency is a fact. A dollarized latency is that fact multiplied by our
   published assumptions. The receipt tells you which is which.
5. **Zero is only claimable for watched surfaces.** "No failures found"
   means the traffic exercised that surface and found none — not that the
   surface was silent.

## Current limits (stated, not hidden)

These are the known gaps between what the instrument measures and what a
reader might assume it measures. Each is on the roadmap below.

- **Time-loss uses wall-clock union semantics.** Ten concurrent calls that
  each run 1s over threshold book 1s of headline time loss, because the
  overlapping elapsed interval is counted once. Row details may still show
  how many failure signals contributed to that interval.
- **Whole-call floors are all-or-nothing.** When a call is flagged as
  failed, its full price enters the loss column, whether the response
  delivered 1% or 99% of its value. Partial-value grading does not exist
  yet.
- **"Estimated recoverable (our arithmetic)" derives from our own
  estimator.** No provider signal currently enters that column; compatibility
  payload fields may still use `providerRecognized*` names, but the rendered
  label must state that the number is our arithmetic estimate.
- **Latency labels its clock.** Provider elapsed timing is used when
  captured; otherwise the receipt labels the figure as `gateway-clock`
  because it can include network segments a provider does not control.
  Provider elapsed timing is captured around the provider fetch boundary and
  does not exclude cold start, DNS, TCP, TLS, or other connection setup time
  when those occur. The dollar translation uses a stated hourly rate and
  threshold you can change.
- **Receipts are not yet tamper-evident.** Events are stored as plain
  append files; a receipt is an honest summary of local data, not yet a
  cryptographically verifiable artifact.
- **Detector coverage is uneven.** Refusal detection is pattern-based
  with a known false-positive surface; duplicate-request detection is
  process-local and keys repeated tenant/provider/request identifiers,
  so invoice verification is still required before treating a duplicate
  identifier as provider double-charging. Some advertised failure classes
  (mid-stream disconnects, client aborts) are not yet instrumented.

## Roadmap

In order of intent: provider-clock attribution where providers expose it ·
wall-clock (union) time-loss semantics · verified-tokenizer-only recounts ·
explicit price states for every call (no silent zeros) · a reliability
tier for any OpenAI-compatible endpoint with money strictly gated on
metered evidence · tamper-evident event ledgers · partial-value grading ·
provider-signal recognition when providers publish credit APIs.

## The standard we accept being held to

Read this document adversarially. If a receipt shows a number this
document cannot justify, that is a bug — file it.
