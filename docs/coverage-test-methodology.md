<!--
Maintainer source map: apps/inferock-bench/src/cli.ts; apps/inferock-bench/src/coverage-test-dashboard.ts; apps/inferock-bench/src/coverage-suite/inferock-coverage-suite-v1.json; apps/inferock-bench/src/coverage-suite/manifest.ts; apps/inferock-bench/src/coverage-suite/baseline.ts; apps/inferock-bench/src/coverage-suite/estimate.ts; apps/inferock-bench/src/coverage-suite/runner.ts; apps/inferock-bench/src/summary.ts.
Before changing a methodology claim here, verify the shipped code paths above.
-->

# Coverage test methodology

`inferock-bench test` runs the complete versioned coverage suite through your local proxy and your configured provider scope. It is not demo data, seeded failures, a provider ranking, or a lite subset. It is normal model work designed to carry the preconditions for every loss surface the receipt claims to watch.

The dashboard uses the same method behind the `Run test` button. To use the real-agent generator, open Advanced options, set Test driver to Agent test, then run the test. Both paths open a consent step; neither starts provider calls directly.

Read this when you want to know how a receipt earns a `watched-clean`, `signal`, or `not-openable` row. The method is staged so consent, provider scope, normal traffic, coverage state, and receipt math stay separate.

| Stage | What to verify |
| --- | --- |
| Consent | Estimated model, suite, baseline, tokens, dollars, pricing source, and spend cap are shown before calls. |
| Scope | Provider runs stay scoped per provider and per request. |
| Traffic | Tasks are ordinary model work with measurement preconditions, not failure bait. |
| Receipt | A zero counts only after the surface was watched; unopened surfaces stay visible as coverage debt. |

## Consent comes first

Before the runner can make a provider call, it estimates the selected provider scope, selected model(s), suite version, baseline version, tokens, dollars, pricing sources, and spend cap. If you stop at that screen, it makes zero provider calls.

The pre-run copy is a price tag for the complete battery, for example:

```text
Running the complete test set on OpenAI, Anthropic, Gemini, and OpenRouter will cost approximately $X.XX total.
Ready to spend ~$X.XX to measure everything?
```

The consent step does not offer switches to skip or trim measures. If pricing is unknown for any selected model, the run is blocked before agent install and before provider calls.

Interactive CLI runs require the typed confirmation `RUN`. Non-interactive runs require `--accept-estimate <hash>`; `--yes` by itself is rejected because it would not prove you accepted the current model, suite, baseline, pricing, and cap. The dashboard start path checks the same estimate hash before it starts.

If a provider key is missing or pricing cannot bound spend, the test fails closed and makes zero provider calls.

## Provider scope

The default scope is all configured providers. You can select one provider or a
subset in the dashboard or with `--providers openai`, `--providers anthropic`,
`--providers gemini`, `--providers openrouter`, or a comma-separated subset such as
`--providers openai,anthropic,gemini,openrouter`.

When more than one provider is selected, each provider runs the complete
13-surface set and eval battery in parallel. The receipt keeps provider run IDs,
drift baselines, ledgers, and `surfaces watched N/13` lines separate, then adds
a combined summary. Cross-provider parallelism does not mix evidence because
measurements are scoped per request and per provider run ID. On small machines,
local CPU or network contention can affect latency interpretation, so the
receipt records that parallel local contention is possible.

Most coverage tasks include the Gemini GenerateContent route. Some checks stay
provider-specific because the shipped code is provider-specific: Anthropic
output-token cross-check runs only on Anthropic Messages traffic, and OpenAI
Responses structured coverage runs only on the OpenAI Responses route.
OpenRouter coverage uses the pinned OpenAI-compatible route and reports
endpoint/served-host evidence separately; OpenRouter support does not imply
every OpenRouter model is measured support.

## Built-in and real-agent generators

The built-in generator remains the primary default. It sends the suite's normal
coverage tasks through the local proxy.

The agent generator is selected with `inferock-bench test --generator agent` or
the dashboard Advanced options path: Test driver -> Agent test. It currently
supports OpenAI and Anthropic routes. Use the built-in generator for Gemini and
OpenRouter coverage; both remain supported for setup, proxying, dashboard
receipts, and the built-in coverage suite within their measured support
boundaries. It runs bundled MIT-licensed Exercism JavaScript
tasks in a scratch workspace using a local coding agent. The harness then fills
every surface precondition the agent's organic behavior did not naturally
carry. The receipt labels `generator=agent`, agent name/version/source, and a
traffic mix split between organic agent tasks and harness-fill tasks.

## The 12 tasks

The v1 suite is `inferock-coverage-suite-v1`, and its task IDs are immutable inside that version. This table is derived from the checked-in manifest.

| Task | What it does | Surface it opens | Why it is normal usage |
| --- | --- | --- | --- |
| `json_schema_extract` | Extracts service, environment, owner, and feature flags from a small config snippet into a declared JSON schema. | `json_schema`, `output_schema_contract`, `latency_token_accounting` | Apps and agents routinely ask models for machine-readable extraction from code or config. |
| `tool_schema_plan` | Reviews a short deployment note and asks the model to call `record_plan` with ordinary structured arguments. | `tool_call_validity`, `latency_token_accounting` | Coding and operations agents use tool/function calls to return plans and findings without side effects. |
| `long_stream_review` | Streams a longer module review covering responsibilities, edge cases, observability gaps, and an implementation plan. | `stream_termination`, `latency_token_accounting` | Interactive coding tools stream longer reviews, plans, and explanations during normal work. |
| `shared_prefix_cache` | Sends repeated stable project-context prefixes with different implementation questions. | `cache_integrity`, `latency_token_accounting` | IDE agents repeatedly send shared project context while asking different normal questions. |
| `identical_rerun_drift` | Re-runs the same stable changelog prompt under a declared drift contract. | `drift_regression`, `latency_token_accounting` | Users rerun the same instruction during a session to check consistency. |
| `known_answer_contract` | Answers a question from an authoritative release record with a declared known-answer contract. | `factuality_known_answer`, `latency_token_accounting` | RAG, support, and test agents answer ordinary questions against supplied records. |
| `sdk_retry_idempotent` | Sends a normal retry-safe operation note with a runner-generated operation ID. | `duplicate_request_id`, `retry_amplification`, `latency_token_accounting` | Production clients attach logical operation IDs while making ordinary requests. |
| `concurrency_wave` | Runs a bounded wave of independent repository-maintenance summaries, each with its own operation ID. | `retry_amplification`, `latency_token_accounting` | Developers and CI systems often run several independent model tasks concurrently. |
| `anthropic_message_baseline` | Sends an ordinary Anthropic Messages maintenance-ticket summary. | `anthropic_token_crosscheck`, `latency_token_accounting` | Normal Anthropic Messages traffic opens Anthropic-specific token cross-checking. |
| `openai_responses_structured` | Sends a structured OpenAI Responses checkpoint request with a declared schema. | `openai_responses_adapter`, `json_schema`, `output_schema_contract`, `latency_token_accounting` | Applications use OpenAI Responses for structured workflow automation. |
| `automatic_latency_token` | Sends a plain engineering-note summary. | `latency_token_accounting` | Every real provider call carries timing, usage, pricing, and status evidence. |
| `organic_safety_overlays` | Sends a neutral change-log summary and lets passive security/content-filter overlays inspect the traffic. | `security_governance`, `openai_content_filter`, `latency_token_accounting` | Normal traffic can be inspected for governance and provider moderation evidence without provoking a signal or manufacturing secrets/leaks. |

The manifest lists method surface definitions. The as-built receipt summarizes the shipped report rows as `surfaces watched N/13`; today that receipt view groups the suite's structured-output definitions into the current report surface model.

`cache_integrity` opens when the run carries the repeated shared-prefix precondition and cache-token evidence. Exact charge reconciliation is included when provider charge observation is available. `CACHE_DISCOUNT_AT_RISK` may also produce an invoice-check exposure headline element and separate detail line from usage plus pricing; that exposure does not enter money loss or recognition gap.

`security_governance` is opened by the normal `organic_safety_overlays` task or by passive security capture/provider safety evidence on ordinary traffic. The suite never sends manufactured secrets, leaks, adversarial prompts, or policy-triggering content to open this surface.

## What we never do

We never use tiny token caps to force truncation. We never ask for adversarial, unsafe, refusal-seeking, policy-triggering, or content-filter bait. We never send malformed JSON, bad schemas, or invalid tool declarations to create a failure. We never manufacture duplicates by hand-crafting request IDs or intentionally sending the same request twice. Normal traffic carries operation/request IDs as a precondition; if no organic duplicate occurs, `duplicate_request_id` is watched-clean. We never try to exhaust quota, force rate limits, or abort streams just to populate a graph.

The manifest loader enforces those rules before a suite can run: it validates routes, schemas, tool declarations, token settings, and request-ID fields, and rejects obvious failure-manufacturing text. The runner-facing v1 suite is also hash-pinned to the checked-in manifest, so arbitrary task definitions are not a user input surface.

## How coverage states work

`watched-clean` means the run carried the precondition, the detector or surface was openable, and no signal was emitted. This is the only kind of zero that counts as clean.

`signal` means the surface was open and real provider traffic emitted one or more signals. The count is actual signal evidence, not a fixture count.

When a priced call emits a signal for a standard-defined bill-bounded failure, the money-loss floor is the call's own priced cost. Provider-recognized loss can still be `$0` until the provider admits the category; the recognition gap is bill-bounded money loss minus provider-recognized. Exposure-only rows such as cache discount at risk are labeled separately with invoice-verification guidance and are not summed. If pricing is missing, the run must carry status `pricing_unknown` and label the limitation as `pricing unknown — add model price` rather than treating the loss as zero.

`not-openable` means the run lacked something required to judge that surface: the selected provider, a supported route or model capability, a configured contract, charge observation, SDK/native retry evidence, or enough completed task calls. That is coverage debt for the run, not evidence that the provider was clean.

This is the normal-usage rule: normal does not mean narrow. The traffic must carry the ordinary preconditions for the measures it claims to watch, while manufacturing the failure stays forbidden. The test sends ordinary tasks; it never manufactures a failure just to fill a receipt row.

## Anthropic Output-Token Recount

`anthropic_token_crosscheck` uses method `anthropic_count_tokens_recount_v1` when enough same-model runtime samples have calibrated Anthropic `messages/count_tokens` against delivered assistant output text. The method subtracts `output_tokens_details.thinking_tokens`, subtracts the runtime-calibrated count_tokens overhead, applies a per-model runtime tolerance band, and dollarizes only verified overcharge deltas at the output-token price. Until calibration is verified, or when count_tokens is unavailable, the row stays in conservative gross-bound fallback posture and does not invent a recount dollar.

Anthropic does not publish a local tokenizer for Claude 3 or later models, and no API returns an independent recount of billed output tokens. Anthropic-side token recounts in this standard are computed against Anthropic's own count_tokens endpoint (documented by Anthropic as an estimate) applied to the delivered output text, with per-model calibration constants and a stated tolerance band; offline estimates use the last tokenizer Anthropic published (Claude 1/2-era, MIT) and are labeled approximate. This is an approximation pending an official public Anthropic tokenizer and will be replaced by it on release.

Method citations: Anthropic Messages count_tokens, https://platform.claude.com/docs/en/build-with-claude/token-counting; Xenova/claude-tokenizer, https://huggingface.co/Xenova/claude-tokenizer, MIT, pinned revision `cae688821ea05490de49a6d3faa36468a4672fad`.

## Spend expectations

This is meant to be local evidence, not a load test. The default is still the complete battery, not a lite subset. A normal measured run should be in the cents to low single dollars range, but the exact token and dollar estimate is always shown before consent. Provider charges, if any, are on your provider account.

The test spend cap applies to the benchmark run it controls. It is not a provider-account hard limit, a per-key budget manager, or protection for traffic that bypasses the local proxy.

The spend cap is part of the accepted estimate. The runner checks the cap before launching new calls and after calls complete. If you abort during a run or hit the cap, already-started provider calls may still be billed by the provider.

## Baseline provenance

The estimate uses the suite manifest, selected model pricing, and the checked-in measured token baseline. The baseline comes from real per-task provider calls recorded through the maintainer `inferock-bench test --record-baseline` path, not synthetic token numbers. It is versioned, tied to the suite manifest hash, and has a content digest so the consent hash changes when the measured baseline changes.

If the baseline file is missing, stale, zero-usage, or marked `bootstrap_required`, the shipped CLI and dashboard treat it as not measured and fail closed before provider calls. The CLI prints ``baseline not measured yet: run `inferock-bench test --record-baseline` with explicit consent to produce a real per-task token baseline.`` The dashboard reports the same degraded state as `baseline_not_measured` with a `bootstrap_required` baseline status. The `--record-baseline` path uses an explicit consent estimate and writes a measured per-task baseline only from real provider events.

## Thresholds and rates

The coverage test opens surfaces and records evidence. The public thresholds, rates, and loss math live in [The Inferock Standard](../spec/standard.md), [Public Signal Semantics](../spec/signals.md), and [SLA Defaults](../spec/sla-defaults.md).

## What to read next

- [Public run card](public-run-2026-07-09.md) for one sanitized aggregate run produced by this method.
- [Evidence grade methodology](evidence-grade-methodology.md) for how detector posture controls provider-recognized recovery.
- [Pricing methodology](pricing-methodology.md) for the `pricing_unknown` rule that prevents silent zero-dollar fallback.
