# Evidence Grade Methodology

Read this when a receipt shows loss that is not provider-recognized. Evidence grade is the guardrail that keeps a measured customer-loss row from turning into a refund claim before the signal-specific requirements are met.

| Posture to check | Why it matters |
| --- | --- |
| Provider-recognized candidate | The row can enter provider-recognized dollars only when the signal-specific evidence requirements are met. |
| Bill-bounded money loss | The receipt can preserve measured customer loss tied to observed spend or charge evidence while keeping provider-recognized recovery at `$0`. |
| Exposure, triage-only, or pricing-unknown | The row stays visible for review or invoice verification without silently becoming dollars in the money-loss headline. |

Evidence grades are detector postures, not manual maintainer ratings.

Each public signal lists required event fields, guards, pricing status, and provider-recognition basis in [signals.md](../spec/signals.md). A row cannot enter provider-recognized dollars unless the signal-specific evidence requirements are met; otherwise it stays unrecognized, triage-only, or pricing-unknown.

The core rule is in [Evidence Postures](../spec/standard.md#evidence-postures): a receipt can show bill-bounded money loss while keeping provider-recognized recovery at `$0`, and it can show invoice-check exposure separately when the evidence is not bill-bounded. That split is intentional. It prevents weak rows from becoming refund claims while preserving what the customer should verify.

Mechanical detector output is still not magic. The event schema must carry the fields needed to reproduce the row, including provider identity, model, timing, usage, attempts, pricing status, and signal-specific evidence. Missing evidence lowers the posture instead of silently filling gaps.

## What to read next

- [Public Signal Semantics](../spec/signals.md) for the signal-by-signal posture and ledger rules.
- [Canonical Event Schema](../spec/event-schema.md) for the fields required to reproduce a row.
- [Hard questions](hard-questions.md) for the public claim boundaries this methodology protects.
