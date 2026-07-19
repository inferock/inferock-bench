# Changelog

Use this file to tie any public receipt claim to the standard version and rule set that produced it. Changelog entries are the public brake against silent rule edits.

| Need | Read |
| --- | --- |
| License text, refusal regex tightening, and measurement-honesty context | [v0.2.1 - 2026-07-19](#v021---2026-07-19) |
| Local security hardening and packaging guardrail | [v0.2.0 - 2026-07-19](#v020---2026-07-19) |
| Money-loss clamp to observed spend | [v0.1.11 - 2026-07-18](#v0111---2026-07-18) |
| Bill-bounded headline and exposure split | [v0.1.10 - 2026-07-10](#v0110---2026-07-10) |
| As-built provider-plane documentation correction | [v0.1.8 - 2026-07-08](#v018---2026-07-08) |
| Current time-loss and receipt-ledger changes | [v0.1.6 - 2026-07-05](#v016---2026-07-05) |
| Initial public draft scope | [v0.1.0 - 2026-07-02](#v010---2026-07-02) |

## v0.2.1 - 2026-07-19

Updated:

- Replaced the short `apps/inferock-bench/LICENSE` pointer with the full Functional Source License 1.1 text for the app, keeping the FSL-1.1-Apache-2.0 SPDX identifier.
- Tightened regex refusal detection to reduce false positives from quoted examples, translation/explanation text, code string literals, and ordinary "I cannot ..." statements that are not answer refusals. Provider-native refusal evidence and classifier verdict handling are unchanged.
- Recorded the README "Why this exists" section and `MEASUREMENT-PHILOSOPHY.md` measurement-honesty addition in this release line. The distinction between observations and interpretations remains explicit, and detector-limit language stays truthful.

## v0.2.0 - 2026-07-19

Security:

- Local dashboard management endpoints are now protected by same-origin dashboard authorization or the local bench key. A bare unauthenticated `GET /api/key` no longer reveals the full local bench key.
- `inferock-bench start` refuses non-loopback hosts by default, including values supplied through `INFEROCK_BENCH_HOST`. Binding to a network-reachable host now requires `--allow-external-host` and prints a warning that the local proxy and management APIs become reachable from other machines that can connect to that host.
- New and touched local run artifacts are written owner-only where the benchmark creates them: `0600` files and `0700` directories for event logs, receipts, share cards, conformance outputs, local agent workspaces, coverage baselines, and related run outputs. Existing files keep their previous permissions until rewritten or touched.

Packaging:

- Added a public packaging guardrail that rebuilds package `dist` output, regenerates the public export, and fails if the exported package output or `npm pack` contents drift from the fresh build.

## v0.1.11 - 2026-07-18

Updated:

- Clamp money-loss to observed spend per-call and in aggregate; add invariant regression test.

## v0.1.10 - 2026-07-10

Updated:

- Made the receipt headline spend-anchored and bill-bounded: `spent $X · money loss $Y · time loss Z · invoice-check exposure $E`.
- Added `invoice-check exposure` as a fourth headline element in bench receipt/dashboard/share-card renders, including `$0.00` when no invoice-check exposure is present. This changes presentation only; exposure stays outside money loss, recognition gap, and the percent-of-spend line.
- Added the secondary presentation line `money loss = X.X% of observed spend` to bench receipt/dashboard/share-card renders, with small-denominator annotation; this changes presentation only, not loss rules.
- Moved `CACHE_DISCOUNT_AT_RISK` out of money-native standard-loss and recognition gap into a separately labeled invoice-check exposure detail line: `cache discount at risk — verify your invoice: $X`.
- Preserved the cache-discount signal, evidence, and per-row wording so the invoice-verification trail remains visible.

Rationale:

- Headline money loss must fit within observed provider spend for the run. Counterfactual or verify-against-invoice amounts are useful evidence, but summing them into standard-loss made the headline less credible.

## v0.1.8 - 2026-07-08

Updated:

- Editorial as-built provider-scope documentation: public bench support includes OpenAI, Anthropic, Gemini, and pinned OpenRouter OpenAI-compatible traffic. OpenRouter measurement remains endpoint-evidence-gated; this changelog entry does not change receipt math or signal rules.

## v0.1.6 - 2026-07-05

Updated:

- Made latency and downtime time-primary measurements while preserving editable dollar translations as secondary context.
- Required separate money and time headlines in receipts and reports; dollars and time must never be summed.
- Added the clustered organic downtime method: retry collapse to logical operations, at least two provider-owned failures, rolling five-minute provider-fault-rate threshold, first-to-last failure floor duration, last-good to first-good uncertainty envelope, sparse-traffic grade lowering, ambiguous-transport exclusion, and status-feed corroboration only.
- Bumped receipt schema to v2 with backward compatibility for stored v1 receipts.
- Added provider-recognition lines for latency and downtime.

## v0.1.0 - 2026-07-02

Initial draft of The Inferock Standard.

Added:

- Versioned standard definitions, failure taxonomy, evidence postures, liability attribution, dual ledgers, recognition gap, denominator rules, and time-loss rules.
- Canonical event v1 and v2 schema documentation based on `packages/measure/src/canonical-event.ts`.
- Public launch-safe signal semantics based on `packages/measure/src/types.ts` and detector implementations in `packages/measure/src/`.
- Provider Disclosure Requirements annex based on the public exported disclosure-requirements view of the maintained measurement-data-integrity source record.
- Static examples labeled as spec fixtures, not measured claims.
- CC-BY-4.0 license text for `spec/`.

## What to read next

- [The Inferock Standard](standard.md) for the current rulebook.
- [Public Signal Semantics](signals.md) for launch-safe signal scope.
- [SLA defaults](sla-defaults.md) for the generated default threshold and time-value view.
