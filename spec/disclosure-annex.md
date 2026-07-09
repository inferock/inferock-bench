# Provider Disclosure Requirements Annex

Version: v0.1.0

Source record: maintained internal measurement-data-integrity notes. The public annex below is the exported disclosure-requirements view; it does not depend on a private path being present in this repository.

The annex is the public disclosure-requirements view; private source notes are not required to apply the standard. Where the annex cites a provider-documentation gap or UNVERIFIED label, public issue reports with provider links can correct the public annex without access to the private notes.

This annex states benchmark disclosure requirements for evidence-grade measurement under The Inferock Standard. It describes current documented gaps from the source record and preserves labels such as UNVERIFIED where the source record uses them. The gaps are benchmark requirements, not unsupported accusations.

Scope note: source-record phrases such as "both providers" refer to the first-party disclosure records evaluated in that section, not the full `inferock-bench` adapter universe.

Use this annex as the provider-disclosure gap list. It explains which provider-side fields, rules, and commitments would make local evidence easier to reconcile; it does not turn a missing disclosure into a provider-admitted charge error.

| Disclosure area | Why it matters to a receipt |
| --- | --- |
| Identity and tier | Served model, backend, tier, geography, and feature state affect price, latency, drift, and retention evidence. |
| Billing semantics and surfaces | Per-call charge rules and request-addressable billing decide whether a row can move toward provider recognition. |
| Retry, safety, retention, and factuality | These surfaces separate measurable evidence from remedy-bearing claims. |

## Quick Read

This non-normative guide gives readers the short route through the annex.

> **TL;DR**
>
> - This annex is the disclosure checklist for making benchmark evidence dispute-grade.
> - It asks providers to expose identity, billing, latency, retry, safety, retention, and factuality surfaces.
> - Documented gaps are benchmark requirements, not unsupported accusations.
> - Labels such as UNVERIFIED preserve the source record's confidence.
> - Use it to see what provider disclosures are missing before a claim can move from evidence to recognition.

### Table of Contents

- [Identity](#identity)
- [Billing Semantics](#billing-semantics)
- [Billing Surfaces](#billing-surfaces)
- [Service-Level Objectives And Latency](#service-level-objectives-and-latency)
- [Retry And Idempotency](#retry-and-idempotency)
- [Safety And Retention](#safety-and-retention)
- [Factuality And Confidence](#factuality-and-confidence)

## Identity

### Served Model And Backend Identity

Providers should disclose the served model, model snapshot, backend or configuration fingerprint, tokenizer or encoding version, and feature state that affected generation on every response.

The source record says OpenAI `seed` plus `system_fingerprint` is now deprecated in the spec, Anthropic exposes no backend fingerprint, and Anthropic added `usage.inference_geo`, `service_tier`, and `stop_details`.

The benchmark requires this because drift, wrong-rate billing, refusal, geography premium, and retention claims need the served identity and actual provider-side state that handled the call.

### Requested And Served Tier Identity

Providers should echo requested tier, served tier, downgrade reason, and fallback state on every response.

The source record says requested-versus-served `service_tier` exists as a capture target for both providers, Anthropic `message_start` carries `service_tier` and `inference_geo`, and silent service-tier downgrades are disclosed only in response.

The benchmark requires tier identity for wrong-rate detection, latency service-level objective selection, fallback-credit eligibility, and proof that the customer received a lower class of service than requested or paid for.

## Billing Semantics

### Failed, Partial, Filtered, And Incomplete Billing

Providers should publish billing rules for 5xx, 408, timeout, client disconnect, post-200 stream errors, partial streams, content filters, and `status=incomplete`, including whether input, hidden tokens, and partial output are charged.

The source record says neither first-party provider documents whether 5xx, timeout, or partial-stream responses are billed. It also says Azure officially bills on processing, including 400 and 408 while excluding 401 and 429. OpenAI content-filter billing is explicit only on Azure; first-party billing is labeled inferred billed and UNVERIFIED explicit. Anthropic post-200 `event:error` is documented. The source record also says Responses adapter value is raised because reasoning-era billed-empty `status=incomplete`, billed, zero visible output is explicitly documented.

The benchmark requires these rules so detectors can separate provider-failed work from customer-caused errors, suppress false refund claims, and compute retry-amplified loss only when failed attempts were chargeable.

### Refusal Billing Invariant

Providers should expose a machine-readable refusal billing rule, including whether refusal happens before output or mid-stream, and should credit calls that violate the rule.

The source record quotes Anthropic's rule that a refusal before output is not billed and says usage token counts are informational for that case. The same record says mid-stream refusal bills input plus streamed output.

The benchmark requires the billing rule because usage fields alone can look chargeable even when policy says no charge.

### Server Tool And Web Search Billing

Providers should itemize server-tool calls, distinguish errored tool attempts from successful tool attempts, and state whether tool failures inside a 200 response are billed.

The source record says Anthropic web-search errors arrive inside a 200 and are claimed unbilled. It labels case 32 as Anthropic web-search billing integrity and says the benchmark should reconcile `usage.server_tool_use.web_search_requests` against observed blocks.

The benchmark requires server-tool usage counts, observed tool blocks, and provider billing rules in one event so customers can prove overcharge or suppress false positives.

### Hidden And Non-Visible Token Classes

Providers should itemize hidden-token classes, including refusal tokens, rejected-prediction tokens, reasoning or thinking tokens, cached-token classes, and non-visible output that affects billing.

The source record says OpenAI recount needs guards for `message.refusal` tokens and rejected-prediction tokens because both are billed outside visible content. It also says Anthropic exposes `usage.output_tokens_details.thinking_tokens` and `cache_creation.ephemeral_5m` and `cache_creation.ephemeral_1h` fields per call.

The benchmark requires hidden-token disclosure because visible text recounts are not enough for billing integrity.

## Billing Surfaces

### Per-Request-Addressable Billing

Every invoice or usage API should let a customer reconcile provider charges to request identifier, response identifier, API key, model, served tier, token category, and timestamp.

The source record says per-request charge matching is impossible on both providers because no billing surface exposes request identifiers and both rely on time-bucketed aggregates. It says Anthropic Usage and Cost Admin APIs provide one-day USD itemization per token type including cache lines, OpenAI Usage API exposes `input_cached_tokens` per key per day, and OpenAI Costs API line-item granularity is UNVERIFIED.

The benchmark records request-level evidence but requires charge surfaces that can join back to the request.

### Usage Category Parity

Billing surfaces should use the same category names and tier or geography dimensions as response usage objects.

The source record says requested-versus-served service tier is needed for wrong-rate detection, Anthropic `usage.inference_geo` billing cross-check is measurable because `us` carries a 1.1x premium on all token categories, and OpenAI has no per-call region field.

The benchmark requires dimensions such as tier, cache mode, token type, and geography to appear in both the response and charge ledger.

### Shared Evidence Standard For Disputed Charges

Providers and customers should share a documented evidence standard for disputed billing classes, including billed-empty or error billing, model substitution, retry storms, and overbilling-rate claims.

The source record says the rejected portion of Vaudit-disputed charges is not publicly documented and may include still-pending disputes. It also records provider public responses via techstartups.com on 2026-06-25 re-reporting The Information. Anthropic is quoted as saying it "does not charge customers for incomplete requests or error messages" and OpenAI is quoted as saying it has "no evidence" those issues are happening among its customers.

The benchmark treats those statements as testable claims for in-path evidence rather than accepting the provider as the sole arbiter of its own ledger.

## Service-Level Objectives And Latency

### Availability Service-Level Objective Parity

First-party APIs should publish availability service-level objectives, downtime definitions, credit percentages, claim windows, and required customer evidence for the same models sold through cloud partners.

The source record says the same models carry credit-backed service-level objectives on clouds but not on first-party APIs. It lists Bedrock credit tiers, Vertex's 99.5 percent objective and customer log-file requirement, Azure's 99.9 percent objective, OpenAI first-party no service-level objective with priority-tier 99.9 percent partially verified but page blocked, and Anthropic first-party none with "AS IS" terms.

The benchmark requires the commitment, window, and evidence rule before downtime loss can become dispute-grade under a provider credit policy. Inferock's organic downtime method requires at least two provider-owned logical-operation failures and provider-fault rate above the provider SLA threshold, or above 5% when no threshold applies, over rolling five-minute windows. It claims only the first-failure to last-failure floor duration, stores the last-good to first-good envelope as uncertainty, lowers grade for sparse traffic, excludes ambiguous transport, and treats status feeds as corroboration only.

### Latency Commitments And Timing Receipts

Providers should publish model and tier latency service-level objectives or throughput floors, queue, prefill, decode, first-token, inter-chunk stall timing, and credit terms.

The source record says OpenAI sells priority latency with no published first-party numbers while Microsoft publishes a per-model table for the same feature. It says OpenAI staff describe latency service-level objectives as contracted enterprise-only, Anthropic has none, and priority tier is no longer sold. It also says Azure priority service-level objective unit is throughput, `99% >100 TPS` for gpt-5.5, p50 per five-minute window. The source record says `openai-processing-ms` exists on success but is undocumented, Anthropic has no processing-time header, and Anthropic `message_start` carries `service_tier` and `inference_geo`.

The benchmark requires timing receipts so external timers can be joined to provider-side attribution rather than remaining impact-only evidence. Without a first-party latency SLA, the provider-recognized latency line is `$0 / 0s`; the standard still reports measured excess time and an editable dollar translation at the customer's rate.

### Silent Tier Degradation

Downgrades, fallback service, and lower-priority serving should be disclosed before billing or with an explicit credit rule.

The source record says silent service-tier downgrades are disclosed only in response.

The benchmark requires served tier before selecting the correct latency service-level objective, price, fallback credit, or route-quality evidence.

## Retry And Idempotency

### Idempotent Inference APIs

Inference APIs should accept an idempotency key or operation identifier, return the original result for safe duplicates, expose conflict semantics, and attach billing to the logical operation instead of each accidental attempt.

The source record says idempotency is absent on both inference APIs. It also says OpenAI's Agentic Commerce Protocol requires merchants to implement `Idempotency-Key` and describes safe duplicate requests returning the same result, while inference APIs expose no equivalent. The source record notes that Stainless SDKs ship the idempotency code path not enabled.

The benchmark requires idempotency because retry storms and duplicate submits can create multiple billed attempts for one user action.

### Provider-Directed Retries And Induced Spend

Providers should document retry headers, retry-after semantics, SDK retry defaults, and whether provider-induced retries are deduplicated or credited.

The source record says all four SDKs honor `x-should-retry`, retry-after or retry-after-ms in the zero-to-sixty-second range, and `x-stainless-retry-count`; it also says the default is two retries. It says providers instruct retries without dedupe or credit for induced double spend.

The benchmark can show retry evidence and now dollarizes retry standard-loss for non-final provider-fault attempts. Grade A uses `x-stainless-retry-count`; Grade B uses body-hash/time-window fallback when the header is absent. Provider-recognized retry recovery remains `$0`, and per-request provider billing absence remains a disclosure gap for provider-recognized recovery.

## Safety And Retention

### Cross-Tenant Non-Contamination Commitment

Providers should commit that one tenant's outputs, prompts, files, and tool results will not be served to another tenant, define the defect class, publish postmortems, and state credit or remedy terms.

The source record says no cross-tenant non-contamination commitment exists anywhere. It lists a June 5, 2026 Claude API incident as an annex exhibit, saying users reported receiving other users' outputs, the status page said only "elevated errors", and there was no postmortem or credit statement in the source record.

The benchmark requires a committed defect class and remedy before exact-match leakage evidence can become provider-recognized accountability.

### Per-Call Retention And Residency Receipts

Every response should disclose the retention regime applied to the call, feature-specific storage exceptions, region or inference geography, and whether flagged-safety retention changed the retention class.

The source record says per-call retention receipts are missing for ZDR, thirty-day, and flagged two-to-seven-year regimes. It says OpenAI has no per-call region field, Anthropic returns `usage.inference_geo`, and Fable 5 and Mythos 5 are ZDR-ineligible "Covered Models" with mandatory thirty-day retention.

The benchmark requires call-level receipts so customers can prove policy compliance, detect wrong-region charges, and attach the right retention exposure to the request.

### Provider-Attributed Safety Evidence

Providers should return machine-readable safety or refusal categories, explanations, recommended model or fallback actions, and moderation verdicts in the same event as billing usage.

The source record says Anthropic exposes `stop_details` with categories such as cyber, bio, frontier_llm, and reasoning_extraction, plus explanation and recommended model. It also says OpenAI inline moderation in June 2026 is opt-in and returns input and output moderation results across thirteen categories.

The benchmark requires provider-attributed safety receipts to distinguish legitimate safety enforcement, over-refusal triage, and billing-rule violations.

## Factuality And Confidence

Broad factuality judging is not part of the v0.1.0 public signal set. The public launch-safe set is limited to customer-provided known-answer contradictions and built-in Anthropic cited-text contradiction checks; broader factuality and confidence disclosures remain future benchmark requirements.

### Deployed-Snapshot Factuality And Confidence Surfaces

Providers should expose ongoing per-deployed-snapshot factuality rates, grounding confidence, and calibrated confidence or log probability surfaces where available.

The source record says providers publish release-time hallucination rates in system cards but do not expose ongoing per-deployed-snapshot API rates. It lists GPT-5 SimpleQA 0.40 to 0.47 and Opus 4.8 35.9 percent as release-time examples, says Vertex grounding support confidence scores are a feasibility proof, says Anthropic exposes no log probabilities, and says OpenAI-only log probability low-confidence triage exists.

The benchmark requires deployed-snapshot confidence because release-time rates do not prove the rate for the snapshot, route, tool mode, or retrieval state that served a customer's call.

### Citation-Support Defect Class And Remedy

Providers should define "citation does not support the cited claim" as a documented defect class with evidence requirements and remedy when they require or encourage citation display.

The source record says both providers mandate citation display while contractually disclaiming accuracy. It says Anthropic guarantees mechanical "valid pointers" and notes that citations are incompatible with structured outputs with a 400 response.

The benchmark requires more than citation presence. It needs a provider-recognized defect class for unsupported citations before citation mismatch can become a remedy-bearing claim.

## What to read next

- [The Inferock Standard](standard.md) for how evidence, recognition, and ledgers are separated.
- [Public Signal Semantics](signals.md) for which disclosure gaps map to launch-safe signal rows.
- [Hard questions](../docs/hard-questions.md) for the public-facing claim boundaries around provider statements and Vaudit context.
