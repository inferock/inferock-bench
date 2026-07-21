# How This Compares

`inferock-bench` is not a replacement for observability, cost management, provider dashboards, or invoice review. It is a local billing-integrity receipt for metered AI calls: per-call evidence, versioned grading, and a failure-cost taxonomy that keeps spend, bill-bounded money loss, time loss, provider-recognized recovery, recognition gap, and invoice-check exposure separate.

This page compares categories, not vendors. It does not score named competitors.

| Category | What it is good at | What it usually does not prove | Where `inferock-bench` fits |
| --- | --- | --- | --- |
| Observability, tracing, and APM | Request traces, latency, errors, retries, logs, service health, and application debugging. | Whether a specific provider-billed AI call met a delivery standard, whether the provider-reported usage matches local evidence, or whether a failure belongs in a bill-bounded loss ledger. | Adds a local receipt that ties provider usage, timing, detector signals, pricing evidence, and failure-cost classification to each measured call. |
| Token and cost estimators | Approximate token counts, projected spend, budget alerts, and model-cost comparisons. | The actual provider-reported bill for the call, hidden token classes, provider-recognized creditability, or delivery failure evidence. | Cross-checks local evidence against provider-reported usage when the provider surface makes that possible, and downgrades weak claims to watch-only states. |
| Provider usage dashboards and billing exports | Provider-authoritative spend totals, account-level usage, invoices, and credit workflows. | Independent per-call delivery evidence held by the customer, especially when the provider only exposes aggregate billing or provider-defined dispute categories. | Gives the customer a local event trail to compare with provider totals and to share as compact, sanitized receipt evidence. |
| Gateways, routers, and fallback systems | Routing, retries, failover, rate limits, provider abstraction, and sometimes cost controls. | Whether the routed call should be classified as bill-bounded loss, provider-recognized recovery, recognition gap, or invoice-check exposure under a published measurement standard. | Measures calls through a local proxy and renders the failure-cost taxonomy instead of only optimizing traffic flow. |
| Model evaluation and quality benchmarks | Task quality, latency, accuracy, regressions, and model comparisons under controlled prompts. | Whether your real metered provider call was billed, failed a delivery rule, or created invoice-check exposure. | Stays run-scoped to observed traffic and avoids turning public runs into provider rankings or industry incidence claims. |
| Invoice-review and audit workflows | Reviewing invoices, contracts, discounts, credits, and dispute materials after charges post. | A contemporaneous per-call receipt for the API request, response, token evidence, retry evidence, and detector posture captured when the call happened. | Supplies the local call evidence an invoice workflow can compare against posted provider charges. |

## Receipt Boundary

A receipt proves what the local benchmark observed and how the shipped grading code classified it. It cannot prove provider intent, inspect calls it did not see, replace a provider invoice, or establish that a public run represents typical market-wide incidence.

The useful distinction is not "one tool replaces the others." It is that most tools watch application behavior, estimate cost, or report provider totals, while `inferock-bench` produces a customer-held per-call billing-integrity receipt with explicit claim strength and limits.

## What To Read Next

- [README receipt contract](../README.md#receipt-contract) for what the receipt proves and cannot prove.
- [Paid-loss arithmetic](loss-arithmetic.md) for the formulas behind money loss, provider-recognized recovery, recognition gap, time loss, and invoice-check exposure.
- [Hard questions](hard-questions.md) for authorship, claim boundaries, and public-run caveats.
- [Threat model](threat-model.md) for local-key, local-file, and production-boundary risks.
