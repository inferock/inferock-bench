# Canonical Event Schema

Version: v0.2.1

Schema source: `packages/measure/src/canonical-event.ts`

This document records the as-built canonical event schema used by The Inferock Standard v0.2.1. Where this document and older prose differ, the TypeScript schema is authoritative.

Use this page when you need to reproduce or integrate receipt evidence. It is the field-level contract behind detector rows; the TypeScript schema remains authoritative when prose and code differ.

| Reader | Useful sections |
| --- | --- |
| Receipt reviewer | [Required And Optional Evidence](#required-and-optional-evidence) |
| Adapter implementer | [Canonical Event v2](#canonical-event-v2) and [Provider Mapping](#provider-mapping) |
| Backward-compatibility reviewer | [Canonical Event v1](#canonical-event-v1) |

## Shared Types

The public `inferock-bench` provider adapters are `openai`, `anthropic`, `gemini`, and pinned `openrouter` OpenAI-compatible traffic. OpenRouter support is measured only when requested pinning, served endpoint metadata, and cited pricing evidence match the current pinned endpoint set. The as-built canonical parser also accepts additional provider identifiers used by compatible or internal records beyond those public app providers: `mistral`, `deepseek_platform`, `deepinfra`, `alibaba_dashscope_us_virginia`, `moonshot_kimi`, `zai`, `together`, and `groq`.

Date and time fields are strings validated as date-time values with an offset.

JSON records are objects with string keys and unknown values.

Objects are strict. Fields not defined by the schema are rejected by the parser.

## Canonical Event v1

Canonical event v1 has no required top-level `schemaVersion`. The parser accepts a top-level `schemaVersion: "v1"` for compatibility and strips it before validation.

| Object | Field | Required | Type or values |
| --- | --- | --- | --- |
| `request` | `tenantId` | Yes | Non-empty string |
| `request` | `provider` | Yes | Provider enum listed in Shared Types |
| `request` | `model` | Yes | Non-empty string |
| `request` | `requestId` | Yes | Non-empty string |
| `request` | `expectCompletion` | No | Boolean |
| `request` | `route` | No | Non-empty string |
| `request` | `workloadClass` | No | Non-empty string |
| `response` | `statusCode` | Yes | Integer from 100 through 599 |
| `response` | `finishReason` | Yes | String |
| `response` | `content` | Yes | String |
| `response` | `toolCalls` | No | Array of JSON records |
| `response` | `errorClass` | No | Non-empty string |
| `usage` | `input` | Yes | Non-negative number |
| `usage` | `output` | Yes | Non-negative number |
| `usage.cache` | `read` | No | Non-negative number |
| `usage.cache` | `creation` | No | Non-negative number |
| `timing` | `startedAt` | Yes | Date-time string with offset |
| `timing` | `endedAt` | Yes | Date-time string with offset |
| `timing` | `latencyMs` | Yes | Non-negative number |
| `timing` | `providerRequestStartedAt` | No | Date-time string with offset |
| `timing` | `providerResponseEndedAt` | No | Date-time string with offset |
| `timing` | `providerElapsedMs` | No | Non-negative number |
| `timing` | `gatewayOverheadMs` | No | Non-negative number |
| `meta` | `attemptIndex` | Yes | Non-negative integer |
| `meta` | `schemaVersion` | Yes | `v1` |
| `meta` | `outputSchemaVersion` | No | Non-empty string |
| `meta` | `source` | No | `proxy` or `drift_replay` |

The v1 normalizer sets `request.requestedModel` to `request.model`, `response.servedModel` to `request.model`, creates usage categories from input, output, cached, and cache-creation tokens, sets `usageSource` to `missing`, and creates one attempt from the v1 event.

The `drift_replay` source exists in the schema for internal replay records. Drift is not part of the v0.2.1 public signal set.

## Canonical Event v2

Canonical event v2 requires `schemaVersion: "v2"` at the top level.

### Request

| Field | Required | Type or values |
| --- | --- | --- |
| `tenantId` | Yes | Non-empty string |
| `provider` | Yes | Provider enum listed in Shared Types |
| `requestId` | Yes | Non-empty string |
| `requestedModel` | Yes | Non-empty string |
| `attemptIndex` | Yes | Non-negative integer |
| `providerRequestId` | No | Non-empty string |
| `model` | No | Non-empty string |
| `apiKeyHash` | No | `sha256:` digest |
| `operationId` | No | Printable operation identifier |
| `bodyHash` | No | `sha256:` digest |
| `bodyHashAlgorithm` | No | `sha256` |
| `bodyHashCanonicalization` | No | `normalized_json_v1` |
| `retryCorrelationId` | No | Non-empty string |
| `expectCompletion` | No | Boolean |
| `route` | No | Non-empty string |
| `workloadClass` | No | Non-empty string |
| `outputSchemaVersion` | No | Non-empty string |
| `providerPlane` | No | Non-empty string |
| `baseUrlHost` | No | Non-empty string |
| `authClass` | No | Non-empty string |
| `endpointSupportStatus` | No | `supported`, `procurement_gated`, or `unsupported` |
| `endpointSupportReason` | No | Non-empty string |
| `generation` | No | JSON record |
| `factualityContract` | No | JSON record |
| `toolDeclarations` | No | Array of tool declarations |
| `securityContext` | No | Request security context |
| `sanitizedHeaders` | No | Record of string values |

Tool declarations require `providerSurface`, `name`, and `schemaHash`. They may include `schema`, `schemaPointer`, `strict`, `toolChoice`, and `parallelToolCalls`.

Request security context records include `captureVersion: "request_secret_digest_v1"`, a digest key id, up to 32 request-secret digest records, `captureComplete`, and `truncated`. Each digest record carries kind, category, field path, match length, HMAC digest, digest algorithm, digest key id, digest scope, and pattern version.

### Response

| Field | Required | Type or values |
| --- | --- | --- |
| `statusCode` | Yes | Integer from 100 through 599 |
| `finishReason` | Yes | String |
| `content` | Yes | String |
| `servedModel` | Yes | Non-empty string |
| `toolCalls` | No | Array of JSON records |
| `rawToolCalls` | No | Array of JSON records |
| `providerRequestId` | No | Non-empty string |
| `providerResponseId` | No | Non-empty string |
| `rawObjectId` | No | Non-empty string |
| `systemFingerprint` | No | Non-empty string |
| `serviceTier` | No | Non-empty string |
| `servedModelSource` | No | `provider_response` or `adapter_fallback` |
| `sanitizedHeaders` | No | Record of string values |
| `rawErrorType` | No | Non-empty string |
| `rawErrorCode` | No | Non-empty string |
| `stopDetails` | No | JSON record |
| `providerSafety` | No | Array of provider safety records |
| `citations` | No | Array of JSON records |
| `grounding` | No | JSON record |
| `logprobs` | No | Array of JSON records |
| `errorClass` | No | Non-empty string |

Provider safety records require `kind`, with values `refusal`, `content_filter`, `safety`, or `moderation`. They may include `source`, `reason`, and `raw`.

### Usage

| Field | Required | Type or values |
| --- | --- | --- |
| `input` | Yes | Non-negative number |
| `output` | Yes | Non-negative number |
| `cache` | No | `read` and `creation` non-negative numbers |
| `categories` | Yes | Array of usage category records |
| `usageSource` | Yes | `provider`, `recomputed`, `missing`, or `partial` |
| `raw` | No | Unknown |
| `pricingStatus` | No | `not_priced`, `priced`, `pricing_unknown`, or `partial` |
| `serviceTier` | No | Non-empty string |
| `inferenceGeo` | No | Non-empty string |
| `iterations` | No | Non-negative integer |

Usage category records require `category` and `tokens`. They may include `sourceField` and `provider`.

### Timing

| Field | Required | Type or values |
| --- | --- | --- |
| `startedAt` | Yes | Date-time string with offset |
| `endedAt` | Yes | Date-time string with offset |
| `latencyMs` | Yes | Non-negative number |
| `providerRequestStartedAt` | No | Date-time string with offset |
| `providerResponseEndedAt` | No | Date-time string with offset |
| `providerElapsedMs` | No | Non-negative number |
| `gatewayOverheadMs` | No | Non-negative number |
| `chunkCount` | Yes | Non-negative integer |
| `terminalStatus` | Yes | `complete`, `error`, `aborted`, or `unknown` |
| `firstEventAt` | No | Date-time string with offset |
| `firstContentDeltaAt` | No | Date-time string with offset |
| `firstByteAt` | No | Date-time string with offset |
| `firstTokenAt` | No | Date-time string with offset |
| `lastChunkAt` | No | Date-time string with offset |
| `timeToFirstEventMs` | No | Non-negative number |
| `timeToFirstContentDeltaMs` | No | Non-negative number |
| `timeToFirstByteMs` | No | Non-negative number |
| `timeToFirstTokenMs` | No | Non-negative number |
| `maxInterChunkGapMs` | No | Non-negative number |
| `maxStreamGapMs` | No | Non-negative number |

The v2 normalizer treats `firstByteAt` as `firstEventAt` when the latter is absent, treats `firstTokenAt` as `firstContentDeltaAt` when the latter is absent, and applies the same compatibility mapping to the corresponding duration fields. It treats `maxStreamGapMs` as `maxInterChunkGapMs` when the latter is absent.

### Attempts

`attempts` is required and must contain at least one attempt record.

| Field | Required | Type or values |
| --- | --- | --- |
| `attemptNumber` | Yes | Non-negative integer |
| `provider` | Yes | Provider enum listed in Shared Types |
| `model` | Yes | Non-empty string |
| `status` | Yes | `success`, `error`, `retry`, or `transport_error` |
| `timing` | Yes | Attempt timing record |
| `finalSelected` | Yes | Boolean |
| `errorClass` | No | Non-empty string |
| `retryReason` | No | Non-empty string |
| `statusCode` | No | Integer from 100 through 599 |
| `providerRequestId` | No | Non-empty string |
| `sanitizedHeaders` | No | Record of string values |

Attempt timing requires `startedAt`, `endedAt`, and `latencyMs`. It may include `providerRequestStartedAt`, `providerResponseEndedAt`, `providerElapsedMs`, `gatewayOverheadMs`, `firstByteAt`, `firstTokenAt`, `lastChunkAt`, `timeToFirstByteMs`, and `timeToFirstTokenMs`.

### Retrieval

`retrieval` is optional. When present, it contains `context`, an array of JSON records.

Retrieval, citations, grounding, log probabilities, and factuality contracts are canonical evidence surfaces. Their presence in the event schema does not make broad factuality judging a public v0.2.1 launch signal; only the evidence-gated known-answer and Anthropic citation-support rows defined in [signals.md](signals.md) are launch-safe public signals.

## Provider Mapping

The provider field maps the event to the provider namespace. The public bench app ships adapters for OpenAI, Anthropic, Gemini, and pinned OpenRouter OpenAI-compatible traffic. The canonical schema accepts the broader enum listed above so compatible records can be normalized without pretending every accepted enum value has the same public app support.

Requested model identity uses v1 `request.model` and v2 `request.requestedModel`. Served model identity uses v2 `response.servedModel`; v1 normalization uses `request.model` as the served model.

Provider request and response identity may appear in `request.providerRequestId`, `response.providerRequestId`, `response.providerResponseId`, `response.rawObjectId`, or sanitized response headers.

Provider safety evidence uses `response.providerSafety`. Anthropic stop details and Gemini safety/finish-reason evidence may also appear in `response.stopDetails`.

Service-tier and geography evidence may appear in `response.serviceTier`, `usage.serviceTier`, and `usage.inferenceGeo`.

Billing evidence uses `usage.input`, `usage.output`, optional cache usage, usage categories, `usage.raw`, `usage.usageSource`, and `usage.pricingStatus`.

Timing evidence uses gateway timing fields and optional streaming timing fields. Provider-specific timing headers, when captured, belong in sanitized headers unless promoted into explicit canonical timing fields.

Tool evidence uses `request.toolDeclarations`, `response.toolCalls`, and `response.rawToolCalls`.

## Required And Optional Evidence

Every public signal requires the core event identity fields: tenant, provider, request identifier, model identity, response status, finish reason, usage, timing, and attempt index.

Provider-recognized recoverable dollar signals additionally require known pricing, provider-origin observed charge evidence, or a signal-specific documented zero-charge rule. Without that evidence, the signal must use `triage_only` or `pricing_unknown` posture.

Optional evidence surfaces strengthen particular signal classes:

| Evidence surface | Signal use |
| --- | --- |
| `outputSchemaVersion` | Declared JSON or schema output failures. |
| `providerSafety` and `stopDetails` | Refusal, content-filter, and billed-empty guards. |
| `usage.categories` | Hidden-output guards, token recount, cache categories, reasoning or thinking token separation, and pricing status. |
| Provider identifiers and sanitized headers | Downtime ownership, transport ambiguity reduction, and support evidence. |
| `serviceTier`, `inferenceGeo`, `route`, and `workloadClass` | Latency policy selection, tier evidence, and pricing or service-level objective context. |
| `attempts` and retry correlation | Retry evidence plus built retry dollarization. Grade A grouping uses `x-stainless-retry-count`; Grade B uses body-hash/time-window fallback. |
| Tool declaration and raw tool-call evidence | Deferred public tool-call validity classes. |

## What to read next

- [Public Signal Semantics](signals.md) for how event fields become public signal rows.
- [The Inferock Standard](standard.md) for the ledger rules those rows feed.
- [Coverage test methodology](../docs/coverage-test-methodology.md) for how normal traffic opens evidence surfaces.
