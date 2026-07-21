# Projection Basis

This page documents the illustrative example used as the README lead image. It is not a customer account measurement, guarantee, or bill audit. It is a synthetic scenario passed through the real `inferock-bench` receipt pipeline so the displayed numbers are pipeline outputs, not hand-typed design figures.

The running dashboard uses `/projection-basis` for this basis view. GitHub and npm readers should use this static page because links baked into a PNG are not clickable in README renders.

## Forward Chain

- Fixed input premise: `$49,673.82/mo` example AI spend.
- Scenario call count chosen before aggregation: `1,270` total example calls = `62` billing-error calls + `43` latency calls + `24` cache-read exposure calls + `1,141` normal traffic calls.
- The billing-error, latency, and cache-read exposure calls are generated first from fixed formulas. Their money loss, time loss, and invoice-check exposure outputs are then accepted as bench-pipeline aggregates.
- Normal traffic calls are the only balancing class. They consume the remaining spend so the receipt title matches the fixed spend premise; they do not carry loss or exposure signals.
- No parameter is adjusted toward a loss, time, or exposure output after the real bench pipeline aggregates the scenario. The spend is the premise; the other numbers are forward-derived outputs, not back-solved targets.

## Scenario Output

- Title-line spend scale: `$49,673.82/mo`.
- Example calls: `1,270`. Real customer calls measured by this scenario: `0`.
- Money loss: `$2,263.20`, aggregated from `62` cache charge-observation example calls.
- Estimated recoverable money: `$1,813.17`; displayed money recognition gap: `$450.03`.
- Time loss: `11m55s` (`~11.9 min`), aggregated from `43` latency example calls.
- Invoice-check exposure: `$1,332.77`, aggregated from `24` cache-read example calls.
- Surfaces watched: `4 / 12`; this is the bench coverage summary for this example event set.
- Approx at your rate: `$18.28`, from `715,144ms` at the local default `$92/hr` time-value assumption.

## Money-Loss Calibration

The external audit anchor is public reporting on Vaudit's TokenAudit launch: reports cite roughly `$1.7M` in overcharges across `$34M` of reviewed AI spend. That is a `5.0%` class-of-spend incidence.

The scenario does not render money loss as spend times rate. Instead, `62` synthetic cache-creation invoice rows carry cache-write token counts and overcharge multipliers, then durable charge observations are fed into `summarizeBenchEvents`. The `CACHE_RATE_ANOMALY` row aggregates the overcharge deltas through the normal receipt path.

Pipeline result: `$2,263.20 / $49,673.82 = 4.556%`, inside the external-audit class.

Estimated recoverable calibration: the cited audit reporting says roughly `80%` was credited when customers disputed. The scenario applies that as an incident-share premise, not as a typed dollar target: `62 x 80% = 49.6`, rounded to `50` provider-recognized billing-error rows. Those `50` rows set `dashboardEligible: true` on their observed invoice charge inputs, so the real pipeline books each row's own overcharge delta as estimated recoverable. The remaining `12` billing-error rows stay `dashboardEligible: false`, so their deltas remain in the recognition gap.

Display split rule: the receipt rounds the total first, then allocates residual cents to split components by largest fractional remainder, so `$1,813.17 + $450.03 = $2,263.20`. Raw stored values remain exact: provider-recognized `1813.172824`; raw recognition gap `450.023311`.

## Time-Loss Calibration

No public AI billing-audit rate for latency incidence is used here. The scenario states its own latency mix instead of claiming an external incidence rate.

The latency threshold is anchored to public provider throughput/SLA materials and the local bench default for interactive streaming non-reasoning calls: `10s + outputTokens * 23ms`. The scenario has `43` successful latency example calls above that local threshold, totaling `715,144ms` of duration loss. Estimated recoverable time stays `~0s` because no first-party latency credit basis is configured for this receipt.

The visible time-value translation is secondary arithmetic: `715,144ms / 3,600,000ms per hour x $92/hr = $18.28`. The `$92/hr` default comes from `SLA_DEFAULTS.timeValueRate`, whose source note references BLS software-developer wage data and BLS private-industry benefit share. It remains editable in the product.

## Invoice-Check Exposure Calibration

Exposure is separate from money loss. It is the cache-discount / billing-interpretation class that says what to verify against an invoice, not what to add to standard-loss dollars.

The scenario has `24` cache-read example calls with `296,171,986` cache-read tokens. The code-backed pricing registry uses `gpt-5.5` full input at `$5.00/M` tokens and cache-read input at `$0.50/M`; the delta is `$4.50/M`.

Pipeline path: `296,171,986 x $4.50/M = $1,332.77` via the native `CACHE_DISCOUNT_AT_RISK` exposure path.

## Honesty Guards

- The README alt text and surrounding copy say the hero is illustrative and not a measured run.
- The image itself carries the yellow banner: "Illustrative example - synthetic scenario through the real bench pipeline."
- The receipt title inside the image says "Illustrative example - $49,673.82/mo spend."
- Real customer calls measured by this scenario: `0`.
- Synthetic counters are labeled as example calls/findings/spend in the receipt render.
- Competitor/provider source names are omitted from the image; source names and caveats live on this page.
- The real measured public evidence remains separate: [See newest measured run ->](public-run-2026-07-10.md).

## Unsourced / Escalation Flags

- Latency incidence has no public audit-rate source. It is an explicit scenario assumption anchored to public throughput/SLA thresholds and Inferock's local SLA-default method, not an externally measured incidence claim.
- No customer-specific invoice evidence is present. Charge observations in this scenario are synthetic inputs used only to exercise the real bench aggregation path.
- This is illustrative calibration, not proof that any provider or customer bill has these exact rates.

## Citations

- Business Wire, June 30, 2026: [Vaudit Launches TokenAudit](https://www.businesswire.com/news/home/20260630108235/en/Vaudit-Launches-TokenAudit-to-Recover-Millions-in-Enterprise-Token-Spend-Billing-Errors-From-Anthropic-OpenAI-and-AI-Providers)
- TechStartups / The Information re-report, June 25, 2026: [Anthropic and OpenAI customers overcharged by $1.7M in billing errors](https://techstartups.com/2026/06/25/anthropic-and-openai-customers-overcharged-by-1-7m-in-billing-errors-startup-audit-finds/)
- OpenAI Scale Tier, cited by source id `OPENAI-SCALE` in [SLA defaults](../spec/sla-defaults.md#latency-segments).
- Azure OpenAI Priority processing latency target: <https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/priority-processing>
- Google Gemini Online Inference SLA: <https://cloud.google.com/vertex-ai/generative-ai/sla>
- Amazon Bedrock service tiers: <https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-service-tiers.html>
- BLS Occupational Outlook Handbook, Software Developers: <https://www.bls.gov/ooh/computer-and-information-technology/software-developers.htm>
- BLS time-value source ids `BLS-OOH`, `BLS-OEWS-2080`, and `BLS-ECEC` in [SLA defaults](../spec/sla-defaults.md#time-value).

## What To Read Next

- [README hero](../README.md) for the visual this basis page explains.
- [See newest measured run ->](public-run-2026-07-10.md) for the current real measured public run card.
- [Asset provenance](../assets/PROVENANCE.md) for the capture hash, dimensions, and masking trail.
- [SLA defaults](../spec/sla-defaults.md#time-value) for the default time-value source note.
