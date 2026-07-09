# Public Signal Semantics

Version: v0.1.0

Schema source: `packages/measure/src/types.ts`

Implementation sources: detector files in `packages/measure/src/`, including `broken-output.ts`, `billing-integrity.ts`, `latency.ts`, `availability.ts`, `refusals.ts`, `pricing-signal.ts`, `tool-call-validity.ts`, `security.ts`, `factuality.ts`, `model-identity.ts`, and `standard-loss.ts`.

This file defines the launch-safe public signal set for The Inferock Standard v0.1.0. It uses the as-built `LossSignal` shape, but it does not expose every signal code present in the implementation enum as a public v0.1.0 standard signal.

The shipped public bench provider planes are OpenAI, Anthropic, Gemini Developer API, and pinned OpenRouter OpenAI-compatible traffic. OpenRouter support is measured only when requested pinning, served endpoint metadata, and cited pricing evidence match the 0.1.8 pinned endpoint set. Provider-specific checks remain provider-specific: OpenAI visible-output recount is OpenAI-only, Anthropic output-token cross-check and citation-support checks are Anthropic-only, Gemini countTokens evidence is input-recount evidence only, and OpenRouter pinned-endpoint evidence does not turn all router models into measured support.

Read this when you need to translate a receipt row into the detector evidence behind it. The page keeps the public launch-safe set separate from implementation enums so weak or deferred classes do not become public refund claims by implication.

| If you are checking | Start with |
| --- | --- |
| The event fields every signal carries | [Signal Shape](#signal-shape) |
| Which codes are public launch-safe | [Launch-Safe Signal Index](#launch-safe-signal-index) |
| The rules for a specific signal | [Signal Details](#signal-details) |
| What is intentionally deferred | [Deferred Public Classes](#deferred-public-classes) |

## Signal Shape

Every signal uses this as-built shape:

| Field | Required | Meaning |
| --- | --- | --- |
| `code` | Yes | Signal code. |
| `detector` | Yes | Detector name. |
| `detectorVersion` | Yes | Detector version string. |
| `tenantId` | Yes | Tenant identity. |
| `requestId` | Yes | Gateway request identity. |
| `provider` | Yes | Public bench providers are `openai`, `anthropic`, `gemini`, and pinned `openrouter`; the as-built schema also accepts the broader canonical provider enum for compatible records. |
| `model` | Yes | Model string used by the event. |
| `domain` | Yes | Signal domain. |
| `failureClass` | Yes | Stable failure class string. |
| `status` | Yes | Signal status. |
| `evidenceGrade` | Yes | Evidence grade. |
| `severity` | Yes | `loss` or `warning`. |
| `dispute` | Yes | Whether the signal is dispute-bearing. |
| `liabilityParty` | Yes | Liability attribution. |
| `creditCandidate` | Yes | Whether the signal can enter provider-recognized recoverable accounting. |
| `valueKind` | Yes | Value kind. |
| `recoverableBasis` | No | `whole_call`, `overcharge_delta`, or null. |
| `tokensBilled` | Yes | Token count used for billing context. |
| `tokensDelivered` | Yes | Token count delivered when supplied by the detector. |
| `costUsd` | Yes | Expected cost from price lookup when available, otherwise zero. |
| `observedChargeUsd` | No | Provider-origin or supplied observed charge when available. |
| `expectedChargeUsd` | No | Expected charge when price or rule evidence supports it. |
| `providerRecoverableLossUsd` | No | Provider-recognized recoverable dollars when the signal qualifies. |
| `pricingVersion` | No | Pricing source version when known. |
| `pricingStatus` | Yes | Pricing status. |
| `valueJson` | No | Structured value payload for rollups and reports. |
| `evidence` | Yes | Structured detector evidence. |

## Enumerated Values

Detector names are `broken-output`, `billing-integrity`, `latency`, `availability`, `refusal`, `pricing`, `model-identity`, `tool-call-validity`, `security-governance`, `factuality-known-answer`, and `factuality-citation-support`.

Signal domains are `loss`, `usage`, `latency`, `drift`, `security`, and `factuality`. The public v0.1.0 launch set uses `loss`, `usage`, `latency`, plus evidence-gated security and factuality rows where a real-loss signal fires. Drift remains a deferred/triage public class.

Signal statuses are `candidate`, `accepted`, `superseded`, `informational`, `triage_only`, and `pricing_unknown`.

Evidence grades are `refundable_candidate`, `unrecognized_standard_loss`, `triage_only`, and `not_applicable`. Public report postures are defined in `standard.md`, including provider-recognized `$0` evidence-only and `pricing_unknown`.

Liability parties are `provider`, `customer`, `shared`, `unknown`, and `not_applicable`.

Value kinds are `money`, `time_loss`, `count`, `security`, and `triage`. Dollar-native real-loss rows use `money`; latency and downtime duration rows use `time_loss`; evidence-only security context may use `security`.

Pricing statuses are `not_priced`, `priced`, `pricing_unknown`, and `partial`.

Recoverable bases are `whole_call` and `overcharge_delta`.

## Launch-Safe Signal Index

Each public signal carries an `evidenceGrade`, `status`, and ledger placement. Ledger rules are defined in `standard.md`.

| Code | Failure class | Value kind | Default posture | Provider-recognized? |
| --- | --- | --- | --- | --- |
| `BROKEN_OUTPUT` | `broken_output` | `money` | `refundable_candidate`, `candidate` when priced; `pricing_unknown` when price lookup is missing or partial | Yes, whole-call candidate when qualified |
| `TRUNCATED` | `truncation` | `money` | `refundable_candidate`, `candidate` when priced; `pricing_unknown` when price lookup is missing or partial | Yes, whole-call candidate when qualified |
| `BILLED_EMPTY` | `empty_output` | `money` | `refundable_candidate`, `candidate` when priced; `pricing_unknown` when price lookup is missing or partial | Yes, whole-call candidate when qualified |
| `REFUSAL_BILLED` | `refusal` | `money` | Provider-native policy/charge evidence can be `refundable_candidate`; otherwise standard-loss or triage posture applies | Conditional |
| `REFUSAL_PREOUTPUT_BILLED_INVARIANT` | `refusal` | `money` | `refundable_candidate`, `candidate` when observed charge evidence exists | Yes, for the observed Anthropic pre-output charge |
| `OPENAI_TOKEN_RECOUNT_MISMATCH` | `token_recount_mismatch` | `money` | `refundable_candidate`, `candidate` when output rate is priced; otherwise `triage_only`/`pricing_unknown` | Yes, overcharge-delta candidate when qualified |
| `ANTHROPIC_TOKEN_CROSSCHECK` | `anthropic_token_crosscheck` | `money` or `triage` | Verified calibrated recount can become Inferock-standard unrecognized overcharge delta; unverified/gross-bound fallback is `triage_only` | No by default; provider-recognized `$0` unless separate provider acceptance exists |
| `PROVIDER_DOWNTIME` | `downtime` | `time_loss` | `refundable_candidate` only for a qualifying provider-owned downtime window under verified provider SLA terms; otherwise `triage_only` | Conditional; creditable only under verified provider SLA/spend terms |
| `LATENCY_BILLED` | `latency` | `time_loss` | `refundable_candidate` only with disclosed `creditBasis: "billed_wait"` and known pricing; otherwise `triage_only` | Conditional |
| `DUPLICATE_REQUEST_ID` | `duplicate_request_id` | `money` | `unrecognized_standard_loss`, `candidate` when priced; `pricing_unknown` when price lookup is missing or partial | No until provider billing evidence proves duplicate charge |
| `CACHE_RATE_ANOMALY` | `cache_rate_anomaly` | `money` | `triage_only` by default; `refundable_candidate` only with dashboard-eligible provider-origin observed charge evidence | Conditional |
| `CACHE_DISCOUNT_AT_RISK` | `cache_discount_at_risk` | `money` | `unrecognized_standard_loss`, `candidate` when cache-read usage and pricing are known; `pricing_unknown` when missing or partial | No; verify against invoice |
| `SECURITY_SECRET_EXACT_MATCH` | `security_secret_leak` when real-loss; otherwise null | `money` for real-loss; `security` for evidence-only context | `unrecognized_standard_loss` on priced real-loss calls; `triage_only` for carried-in-request/evidence-only context | No |
| `FACTUALITY_KNOWN_ANSWER_FAIL` | `factuality_contradiction` | `money` | `unrecognized_standard_loss`, `candidate` when priced; `pricing_unknown` when price lookup is missing or partial | No |
| `ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT` | `factuality_contradiction` | `money` | `unrecognized_standard_loss`, `candidate` when priced; `pricing_unknown` when price lookup is missing or partial | No; Anthropic-specific |
| `PRICING_UNKNOWN` | `pricing_unknown` or `pricing_partial` | `triage` | `triage_only`, `pricing_unknown` | No dollar recognition until price is added |

## Signal Details

### `BROKEN_OUTPUT`

Detector: `broken-output`.

The response fails a declared JSON parse or schema validation contract. Provider-native refusal or content-filter evidence suppresses an independent broken-output claim. Gemini sent response-schema evidence is supported where the adapter captured the sent Gemini schema; OpenAI and Anthropic use their shipped schema/tool evidence paths.

### `TRUNCATED`

Detector: `broken-output`.

The provider terminal reason is `length`, `max_tokens`, or Anthropic `model_context_window_exceeded`. Caller-owned tiny token caps and context-window input envelope cases are triage rather than provider-recognized whole-call claims.

### `BILLED_EMPTY`

Detector: `broken-output` or `billing-integrity`.

The event reports billed output tokens with empty visible content, no hidden output tokens, no tool calls, no excluded finish reason, and no provider safety explanation. Gemini thinking-token evidence is handled only when the usage categories reconcile; unverified thinking-token evidence does not create a billed-empty dollar claim.

### `REFUSAL_BILLED`

Detector: `refusal`.

Provider-native refusal, regex refusal, or classifier refusal evidence appears on a call where completion was expected and billed usage exists. Detection source is stored as evidence (`provider_native` or `classifier`) and does not gate whether the dollarized standard floor appears.

Provider-native policy or charge evidence can make a refusal a provider-recognized whole-call candidate. Otherwise the row stays in Inferock-standard call-cost floor posture with provider-recognized `$0`, or triage where the detector lacks enough evidence. Gemini provider-native safety/refusal evidence is captured as `provider_gemini`; it does not inherit Anthropic's pre-output refusal billing invariant.

### `REFUSAL_PREOUTPUT_BILLED_INVARIANT`

Detector: `refusal`.

Anthropic pre-output refusal with empty visible content is treated as a zero-charge invariant. This signal emits only when observed charge evidence proves a positive charge. Informational usage alone does not emit it.

### `OPENAI_TOKEN_RECOUNT_MISMATCH`

Detector: `billing-integrity`.

OpenAI visible output tokens are independently recounted with the model encoding, known hidden output tokens are subtracted, tool calls, multiple choices, blank content, and native refusal are excluded, and only overcounts beyond tolerance are candidates.

### `ANTHROPIC_TOKEN_CROSSCHECK`

Detector: `billing-integrity`.

`billed_visible = usage.output_tokens - output_tokens_details.thinking_tokens`; `recount = Anthropic messages.count_tokens(delivered assistant output) - runtime_calibrated_overhead(model)`; a candidate emits only when `billed_visible - recount` exceeds the runtime per-model tolerance.

Verified calibrated recount deltas emit `status: candidate`, `evidenceGrade: triage_only` before standard-loss enrichment and cap method evidence at grade B. When the calibrated recount is verified and priced, it can emit an Inferock-standard unrecognized overcharge delta. Gross-bound fallback remains triage-only with provider-recognized `$0`; delivered calls get no crosscheck floor. A call that failed to deliver and also fired crosscheck gets its whole-call floor from the delivery failure, once.

Anthropic token cross-check method note: `anthropic_count_tokens_recount_v1` uses `billed_visible = usage.output_tokens - output_tokens_details.thinking_tokens`, Anthropic `messages.count_tokens` on delivered assistant output as the recount oracle, runtime per-model calibration (`R`, overhead, and `tau`) with provenance, and a grade-B evidence cap. Offline estimates use `Xenova/claude-tokenizer` (MIT) at pinned revision `cae688821ea05490de49a6d3faa36468a4672fad`. Citations: https://huggingface.co/Xenova/claude-tokenizer and https://platform.claude.com/docs/en/build-with-claude/token-counting.

Verbatim caveat: Anthropic does not publish a local tokenizer for Claude 3 or later models, and no API returns an independent recount of billed output tokens. Anthropic-side token recounts in this standard are computed against Anthropic's own count_tokens endpoint (documented by Anthropic as an estimate) applied to the delivered output text, with per-model calibration constants and a stated tolerance band; offline estimates use the last tokenizer Anthropic published (Claude 1/2-era, MIT) and are labeled approximate. This is an approximation pending an official public Anthropic tokenizer and will be replaced by it on release.

### `PROVIDER_DOWNTIME`

Detector: `availability`.

Provider-owned 5xx, timeout, overloaded, or capacity evidence is captured and clustered only after retry collapse to logical operations. A downtime window requires at least two provider-owned failures and a provider-fault rate above the applicable provider SLA threshold, or above the Inferock standard-defined default of >5% if no provider threshold applies, over rolling five-minute windows.

The default is medium-confidence outside provider-specific SLAs and is not provider-accepted credit proof. Floor duration is first provider failure to last provider failure; last-good to first-good envelope is stored as uncertainty. Status-feed corroboration may raise grade but cannot create a window. Gemini has provider-specific ownership handling for Google status codes and capacity evidence; Gemini/Vertex SLA threshold provenance can be represented when the event carries the applicable service-plane evidence.

### `LATENCY_BILLED`

Detector: `latency`.

The measured `latencyMs` exceeds the effective latency service-level objective for the call, the call has billed tokens, and the event is not already provider downtime. Evidence includes `latencyMs`, `sloMs`, `excessWaitMs`, source, version, route, workload class, and timing.

Provider-recognized latency requires a disclosed policy with `creditBasis: "billed_wait"` and known pricing. Real excess milliseconds also support the unrecognized time-loss ledger.

### `DUPLICATE_REQUEST_ID`

Detector: `billing-integrity`.

The same tenant, provider, and request identifier was observed more than once. The signal proves repeated gateway request identifiers, not provider double-charging. Per-event render shows the duplicate call's priced cost and flags it to verify against the invoice.

### `CACHE_RATE_ANOMALY`

Detector: `billing-integrity`.

Cache read or cache creation usage is reconciled against expected pricing. Without eligible provider-origin charge evidence, the row preserves evidence without provider-recognized dollars. With dashboard-eligible provider-origin observed charge evidence, it can become a provider-recognized overcharge-delta candidate.

### `CACHE_DISCOUNT_AT_RISK`

Detector: `billing-integrity`.

From usage and pricing alone: `cache_read_tokens x (full input rate - cache read rate)`. This is an at-risk discount amount, not provider-recognized recovery and not a whole-call floor. The row tells the user to verify against the invoice.

### `SECURITY_SECRET_EXACT_MATCH`

Detector: `security-governance`.

Exact output-secret leakage is a real-loss security signal unless attribution says the secret was carried in request context. Provider safety fields without a loss event remain non-loss evidence.

### `FACTUALITY_KNOWN_ANSWER_FAIL`

Detector: `factuality-known-answer`.

A customer-supplied known-answer contract is contradicted by the response under exact/numeric/date/entity checks.

### `ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT`

Detector: `factuality-citation-support`.

Anthropic cited-text evidence contradicts the cited text under the built citation-support check. Broad factuality judging remains out of scope.

### `PRICING_UNKNOWN`

Detector: `pricing`.

Pricing lookup is missing or partial. The signal preserves the evidence and prevents silent zero-dollar treatment; the report labels `pricing_unknown -- add model price` instead of showing `$0` loss.

## Required Ledger Handling

Whole-call recoverable candidates compete with other whole-call recoverable candidates for the same call. Only one whole-call recoverable winner may remain provider-recognized for a call. Overcharge-delta candidates may stack with a whole-call winner because they represent separate deltas.

`LATENCY_BILLED` uses `time_loss` and a null recoverable basis in the detector. If a whole-call recoverable winner exists for the same call, latency can be demoted to triage-only time-loss evidence. First-party standard-tier latency without an explicit provider SLA renders `provider-recognized: $0 / 0s without a first-party latency SLA`; absent service-tier/contract evidence renders "no configured provider latency credit basis for this receipt." The editable dollar translation remains secondary context.

`PROVIDER_DOWNTIME` uses `time_loss` for downtime windows and preserves per-call provider-failure evidence. Verified cloud-SLA provenance can make downtime creditable, but recoverable dollars are capped by the provider's spend/credit terms and never become a combined money-plus-time total. OpenAI/Anthropic first-party credit caps remain unverified.

Pricing-unknown candidates preserve evidence but contribute no provider-recognized recoverable dollars and no standard-loss dollar figure until the missing model price is added.

## Deferred Public Classes

The as-built enum contains additional codes that are not part of the public v0.1.0 launch-safe signal set in this Track D draft.

| Code or domain | Public v0.1.0 status |
| --- | --- |
| `MALFORMED_TOOL_CALL` | Deferred from the public launch set, although the as-built enum and detector exist. |
| `TOOL_CALL_SCHEMA_VIOLATION` | Deferred from the public launch set, although the as-built enum and detector exist. |
| `UNDECLARED_TOOL_CALL` | Deferred from the public launch set, although the as-built enum and detector exist. |
| `TOOL_CHOICE_VIOLATION` | Deferred from the public launch set, although the as-built enum contains the code. |
| `TOOL_CALL_STOP_REASON_MISMATCH` | Deferred from the public launch set, although the as-built enum and detector exist. |
| Drift domain | Deferred public class. It must not create refundable drift dollars in v0.1.0. |
| Security domain | Deferred public class except for the evidence-gated real-loss row listed above. Broader security signals must remain outside the v0.1.0 public signal set. |
| Factuality domain | Deferred public class except for the evidence-gated known-answer and Anthropic citation-support rows listed above. Broader factuality judging must remain outside the v0.1.0 public signal set. |

## What to read next

- [The Inferock Standard](standard.md) for evidence posture, ledgers, denominators, and versioning rules.
- [Canonical Event Schema](event-schema.md) for the fields a signal can cite as proof.
- [Evidence grade methodology](../docs/evidence-grade-methodology.md) for the short public explanation of detector posture.
