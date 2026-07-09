# Changelog

Use this file to tie any public receipt claim to the standard version and rule set that produced it. Changelog entries are the public brake against silent rule edits.

| Need | Read |
| --- | --- |
| As-built provider-plane documentation correction | [v0.1.8 - 2026-07-08](#v018---2026-07-08) |
| Current time-loss and receipt-ledger changes | [v0.1.6 - 2026-07-05](#v016---2026-07-05) |
| Initial public draft scope | [v0.1.0 - 2026-07-02](#v010---2026-07-02) |

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
