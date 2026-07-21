import { z } from "zod";
export const CanonicalProvider = z.enum([
    "openai",
    "anthropic",
    "gemini",
    "mistral",
    "deepseek_platform",
    "deepinfra",
    "alibaba_dashscope_us_virginia",
    "moonshot_kimi",
    "zai",
    "together",
    "groq",
    "openrouter",
]);
const ServedModelSource = z.enum(["provider_response", "adapter_fallback"]);
const DateTime = z.string().datetime({ offset: true });
const JsonRecord = z.record(z.string(), z.unknown());
export const CANONICAL_OPERATION_ID_MAX_LENGTH = 512;
const CANONICAL_OPERATION_ID_PRINTABLE_ASCII = /^[\x20-\x7E]+$/;
export function isCanonicalOperationId(value) {
    return value.length >= 1 &&
        value.length <= CANONICAL_OPERATION_ID_MAX_LENGTH &&
        CANONICAL_OPERATION_ID_PRINTABLE_ASCII.test(value);
}
const CacheUsage = z
    .object({
    read: z.number().nonnegative().optional(),
    creation: z.number().nonnegative().optional(),
})
    .strict();
const ToolCall = JsonRecord;
const ErrorOrigin = z.enum(["local", "provider"]);
const EventSource = z.enum(["proxy", "drift_replay"]);
const WallClockDrift = z
    .object({
    kind: z.enum(["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]),
    wallClockElapsedMs: z.number(),
    monotonicElapsedMs: z.number().nonnegative(),
    driftMs: z.number(),
})
    .strict();
const CanonicalEventV1Request = z
    .object({
    tenantId: z.string().min(1),
    provider: CanonicalProvider,
    model: z.string().min(1),
    requestId: z.string().min(1),
    expectCompletion: z.boolean().optional(),
    route: z.string().min(1).optional(),
    workloadClass: z.string().min(1).optional(),
})
    .strict();
const CanonicalEventV1Response = z
    .object({
    statusCode: z.number().int().min(100).max(599),
    finishReason: z.string(),
    content: z.string(),
    toolCalls: z.array(ToolCall).optional(),
    errorClass: z.string().min(1).optional(),
    errorOrigin: ErrorOrigin.optional(),
})
    .strict();
const CanonicalEventV1Usage = z
    .object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cache: CacheUsage.optional(),
})
    .strict();
const CanonicalEventV1Timing = z
    .object({
    startedAt: DateTime,
    endedAt: DateTime,
    latencyMs: z.number().nonnegative(),
    monotonicElapsedMs: z.number().nonnegative().optional(),
    monotonicClockSource: z.string().min(1).optional(),
    wallClockDrift: WallClockDrift.optional(),
    providerRequestStartedAt: DateTime.optional(),
    providerResponseEndedAt: DateTime.optional(),
    providerElapsedMs: z.number().nonnegative().optional(),
    providerMonotonicElapsedMs: z.number().nonnegative().optional(),
    providerWallClockDrift: WallClockDrift.optional(),
    gatewayOverheadMs: z.number().nonnegative().optional(),
    clientConsumptionEndedAt: DateTime.optional(),
})
    .strict();
const CanonicalEventV1Meta = z
    .object({
    attemptIndex: z.number().int().nonnegative(),
    schemaVersion: z.literal("v1"),
    outputSchemaVersion: z.string().min(1).optional(),
    source: EventSource.optional(),
})
    .strict();
/**
 * @contract-id canonical-event-v1
 */
export const CanonicalEventV1 = z
    .object({
    request: CanonicalEventV1Request,
    response: CanonicalEventV1Response,
    usage: CanonicalEventV1Usage,
    timing: CanonicalEventV1Timing,
    meta: CanonicalEventV1Meta,
})
    .strict();
const ToolDeclaration = z
    .object({
    providerSurface: z.string().min(1),
    name: z.string().min(1),
    schemaHash: z.string().min(1),
    schema: z.unknown().optional(),
    schemaPointer: z.string().min(1).optional(),
    strict: z.boolean().optional(),
    toolChoice: z.unknown().optional(),
    parallelToolCalls: z.boolean().optional(),
})
    .strict();
const UsageCategory = z
    .object({
    category: z.string().min(1),
    tokens: z.number().nonnegative(),
    sourceField: z.string().min(1).optional(),
    provider: CanonicalProvider.optional(),
})
    .strict();
const UsageSource = z.enum(["provider", "recomputed", "missing", "partial"]);
const PricingStatus = z.enum(["not_priced", "priced", "pricing_unknown", "partial"]);
const StreamTerminalStatus = z.enum(["complete", "error", "aborted", "unknown"]);
const AttemptStatus = z.enum(["success", "error", "retry", "transport_error"]);
const BodyHash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ApiKeyHash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const OperationId = z.string()
    .min(1)
    .max(CANONICAL_OPERATION_ID_MAX_LENGTH)
    .regex(CANONICAL_OPERATION_ID_PRINTABLE_ASCII);
const RequestSecretDigest = z.string()
    .regex(/^hmac-sha256:[A-Za-z0-9_.-]{1,128}:[a-f0-9]{64}$/);
const RequestSecretDigestKeyId = z.string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.-]+$/);
const RequestSecretFieldPath = z.string()
    .min(1)
    .max(512)
    .regex(CANONICAL_OPERATION_ID_PRINTABLE_ASCII);
const RequestSecurityContext = z
    .object({
    captureVersion: z.literal("request_secret_digest_v1"),
    digestKeyId: RequestSecretDigestKeyId,
    requestSecretDigests: z.array(z
        .object({
        kind: z.literal("secret"),
        category: z.string().min(1).max(128),
        fieldPath: RequestSecretFieldPath,
        matchLength: z.number().int().positive().max(8192),
        digest: RequestSecretDigest,
        digestAlgorithm: z.literal("hmac-sha256"),
        digestKeyId: RequestSecretDigestKeyId,
        digestScope: z.literal("event"),
        patternVersion: z.literal("security-governance:v0"),
    })
        .strict()).max(32),
    captureComplete: z.boolean(),
    truncated: z.boolean(),
})
    .strict()
    .superRefine((context, issueContext) => {
    if (context.truncated && context.captureComplete) {
        issueContext.addIssue({
            code: z.ZodIssueCode.custom,
            message: "truncated request-secret capture cannot be complete",
            path: ["captureComplete"],
        });
    }
});
const ProviderSafety = z
    .object({
    kind: z.enum(["refusal", "content_filter", "safety", "moderation"]),
    source: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    raw: z.unknown().optional(),
})
    .strict();
const Retrieval = z
    .object({
    context: z.array(JsonRecord),
})
    .strict();
const TimingV2 = CanonicalEventV1Timing.extend({
    firstEventAt: DateTime.optional(),
    firstContentDeltaAt: DateTime.optional(),
    firstByteAt: DateTime.optional(),
    firstTokenAt: DateTime.optional(),
    lastChunkAt: DateTime.optional(),
    timeToFirstEventMs: z.number().nonnegative().optional(),
    timeToFirstContentDeltaMs: z.number().nonnegative().optional(),
    timeToFirstByteMs: z.number().nonnegative().optional(),
    timeToFirstTokenMs: z.number().nonnegative().optional(),
    chunkCount: z.number().int().nonnegative(),
    maxInterChunkGapMs: z.number().nonnegative().optional(),
    maxStreamGapMs: z.number().nonnegative().optional(),
    terminalStatus: StreamTerminalStatus,
}).strict();
const AttemptTiming = CanonicalEventV1Timing.extend({
    firstByteAt: DateTime.optional(),
    firstTokenAt: DateTime.optional(),
    lastChunkAt: DateTime.optional(),
    timeToFirstByteMs: z.number().nonnegative().optional(),
    timeToFirstTokenMs: z.number().nonnegative().optional(),
}).strict();
const AttemptRecord = z
    .object({
    attemptNumber: z.number().int().nonnegative(),
    provider: CanonicalProvider,
    model: z.string().min(1),
    status: AttemptStatus,
    timing: AttemptTiming,
    errorClass: z.string().min(1).optional(),
    errorOrigin: ErrorOrigin.optional(),
    retryReason: z.string().min(1).optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    providerRequestId: z.string().min(1).optional(),
    sanitizedHeaders: z.record(z.string(), z.string()).optional(),
    finalSelected: z.boolean(),
})
    .strict();
/**
 * @contract-id canonical-event-v2
 */
export const CanonicalEventV2 = z
    .object({
    schemaVersion: z.literal("v2"),
    request: z
        .object({
        tenantId: z.string().min(1),
        provider: CanonicalProvider,
        requestId: z.string().min(1),
        providerRequestId: z.string().min(1).optional(),
        requestedModel: z.string().min(1),
        model: z.string().min(1).optional(),
        attemptIndex: z.number().int().nonnegative(),
        apiKeyHash: ApiKeyHash.optional(),
        operationId: OperationId.optional(),
        bodyHash: BodyHash.optional(),
        bodyHashAlgorithm: z.literal("sha256").optional(),
        bodyHashCanonicalization: z.literal("normalized_json_v1").optional(),
        retryCorrelationId: z.string().min(1).optional(),
        expectCompletion: z.boolean().optional(),
        route: z.string().min(1).optional(),
        workloadClass: z.string().min(1).optional(),
        outputSchemaVersion: z.string().min(1).optional(),
        providerPlane: z.string().min(1).optional(),
        baseUrlHost: z.string().min(1).optional(),
        authClass: z.string().min(1).optional(),
        endpointSupportStatus: z.enum(["supported", "procurement_gated", "unsupported"]).optional(),
        endpointSupportReason: z.string().min(1).optional(),
        generation: JsonRecord.optional(),
        factualityContract: JsonRecord.optional(),
        toolDeclarations: z.array(ToolDeclaration).optional(),
        securityContext: RequestSecurityContext.optional(),
        sanitizedHeaders: z.record(z.string(), z.string()).optional(),
    })
        .strict(),
    response: z
        .object({
        statusCode: z.number().int().min(100).max(599),
        finishReason: z.string(),
        content: z.string(),
        toolCalls: z.array(ToolCall).optional(),
        rawToolCalls: z.array(ToolCall).optional(),
        servedModel: z.string().min(1),
        providerRequestId: z.string().min(1).optional(),
        providerResponseId: z.string().min(1).optional(),
        rawObjectId: z.string().min(1).optional(),
        systemFingerprint: z.string().min(1).optional(),
        serviceTier: z.string().min(1).optional(),
        servedModelSource: ServedModelSource.optional(),
        sanitizedHeaders: z.record(z.string(), z.string()).optional(),
        rawErrorType: z.string().min(1).optional(),
        rawErrorCode: z.string().min(1).optional(),
        stopDetails: JsonRecord.optional(),
        providerSafety: z.array(ProviderSafety).optional(),
        citations: z.array(JsonRecord).optional(),
        grounding: JsonRecord.optional(),
        logprobs: z.array(JsonRecord).optional(),
        errorClass: z.string().min(1).optional(),
        errorOrigin: ErrorOrigin.optional(),
    })
        .strict(),
    usage: CanonicalEventV1Usage.extend({
        raw: z.unknown().optional(),
        categories: z.array(UsageCategory),
        usageSource: UsageSource,
        pricingStatus: PricingStatus.optional(),
        serviceTier: z.string().min(1).optional(),
        inferenceGeo: z.string().min(1).optional(),
        iterations: z.number().int().nonnegative().optional(),
    }).strict(),
    timing: TimingV2,
    attempts: z.array(AttemptRecord).min(1),
    retrieval: Retrieval.optional(),
})
    .strict();
const CanonicalEventV1ForAny = z.preprocess(stripTopLevelV1SchemaVersion, CanonicalEventV1.omit({ meta: true })
    .extend({
    meta: CanonicalEventV1Meta.extend({
        schemaVersion: z.literal("v1").default("v1"),
    }).strict(),
})
    .strict());
export const CanonicalEventAny = z.union([CanonicalEventV2, CanonicalEventV1ForAny]);
export function normalizeCanonicalEvent(event) {
    if (eventIsV2(event))
        return normalizeV2(event);
    return normalizeV1(event);
}
function stripTopLevelV1SchemaVersion(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
    const record = value;
    if (record.schemaVersion !== "v1")
        return value;
    const { schemaVersion: _schemaVersion, ...rest } = record;
    return rest;
}
function eventIsV2(event) {
    return "schemaVersion" in event && event.schemaVersion === "v2";
}
function normalizeV1(event) {
    const attemptStatus = event.response.statusCode >= 400 || event.response.errorClass ? "error" : "success";
    return {
        ...event,
        schemaVersion: "v1",
        rawOriginalEvent: event,
        request: {
            ...event.request,
            requestedModel: event.request.model,
            attemptIndex: event.meta.attemptIndex,
            ...(event.meta.outputSchemaVersion ? { outputSchemaVersion: event.meta.outputSchemaVersion } : {}),
        },
        response: {
            ...event.response,
            servedModel: event.request.model,
        },
        usage: {
            ...event.usage,
            categories: usageCategoriesFromV1(event),
            usageSource: "missing",
        },
        timing: {
            ...event.timing,
            chunkCount: 0,
            terminalStatus: attemptStatus === "error" ? "error" : "complete",
        },
        attempts: [
            {
                attemptNumber: event.meta.attemptIndex,
                provider: event.request.provider,
                model: event.request.model,
                status: attemptStatus,
                timing: event.timing,
                ...(event.response.errorClass ? { errorClass: event.response.errorClass } : {}),
                ...(event.response.errorOrigin ? { errorOrigin: event.response.errorOrigin } : {}),
                finalSelected: true,
            },
        ],
    };
}
function normalizeV2(event) {
    return {
        request: {
            tenantId: event.request.tenantId,
            provider: event.request.provider,
            model: event.request.model ?? event.request.requestedModel,
            requestId: event.request.requestId,
            requestedModel: event.request.requestedModel,
            attemptIndex: event.request.attemptIndex,
            ...(event.request.providerRequestId ? { providerRequestId: event.request.providerRequestId } : {}),
            ...(event.request.apiKeyHash ? { apiKeyHash: event.request.apiKeyHash } : {}),
            ...(event.request.operationId ? { operationId: event.request.operationId } : {}),
            ...(event.request.bodyHash ? { bodyHash: event.request.bodyHash } : {}),
            ...(event.request.bodyHashAlgorithm ? { bodyHashAlgorithm: event.request.bodyHashAlgorithm } : {}),
            ...(event.request.bodyHashCanonicalization
                ? { bodyHashCanonicalization: event.request.bodyHashCanonicalization }
                : {}),
            ...(event.request.retryCorrelationId ? { retryCorrelationId: event.request.retryCorrelationId } : {}),
            ...(event.request.expectCompletion !== undefined ? { expectCompletion: event.request.expectCompletion } : {}),
            ...(event.request.route ? { route: event.request.route } : {}),
            ...(event.request.workloadClass ? { workloadClass: event.request.workloadClass } : {}),
            ...(event.request.outputSchemaVersion ? { outputSchemaVersion: event.request.outputSchemaVersion } : {}),
            ...(event.request.providerPlane ? { providerPlane: event.request.providerPlane } : {}),
            ...(event.request.baseUrlHost ? { baseUrlHost: event.request.baseUrlHost } : {}),
            ...(event.request.authClass ? { authClass: event.request.authClass } : {}),
            ...(event.request.endpointSupportStatus
                ? { endpointSupportStatus: event.request.endpointSupportStatus }
                : {}),
            ...(event.request.endpointSupportReason ? { endpointSupportReason: event.request.endpointSupportReason } : {}),
            ...(event.request.generation ? { generation: event.request.generation } : {}),
            ...(event.request.factualityContract ? { factualityContract: event.request.factualityContract } : {}),
            ...(event.request.toolDeclarations ? { toolDeclarations: event.request.toolDeclarations } : {}),
            ...(event.request.securityContext ? { securityContext: event.request.securityContext } : {}),
            ...(event.request.sanitizedHeaders ? { sanitizedHeaders: event.request.sanitizedHeaders } : {}),
        },
        response: event.response,
        usage: event.usage,
        timing: normalizedV2Timing(event.timing),
        meta: {
            attemptIndex: event.request.attemptIndex,
            schemaVersion: "v1",
            ...(event.request.outputSchemaVersion ? { outputSchemaVersion: event.request.outputSchemaVersion } : {}),
        },
        schemaVersion: "v2",
        rawOriginalEvent: event,
        attempts: event.attempts,
        ...(event.retrieval ? { retrieval: event.retrieval } : {}),
    };
}
function normalizedV2Timing(eventTiming) {
    return {
        ...eventTiming,
        ...(eventTiming.firstEventAt === undefined && eventTiming.firstByteAt !== undefined
            ? { firstEventAt: eventTiming.firstByteAt }
            : {}),
        ...(eventTiming.firstContentDeltaAt === undefined && eventTiming.firstTokenAt !== undefined
            ? { firstContentDeltaAt: eventTiming.firstTokenAt }
            : {}),
        ...(eventTiming.timeToFirstEventMs === undefined && eventTiming.timeToFirstByteMs !== undefined
            ? { timeToFirstEventMs: eventTiming.timeToFirstByteMs }
            : {}),
        ...(eventTiming.timeToFirstContentDeltaMs === undefined && eventTiming.timeToFirstTokenMs !== undefined
            ? { timeToFirstContentDeltaMs: eventTiming.timeToFirstTokenMs }
            : {}),
        ...(eventTiming.maxInterChunkGapMs === undefined && eventTiming.maxStreamGapMs !== undefined
            ? { maxInterChunkGapMs: eventTiming.maxStreamGapMs }
            : {}),
    };
}
export function canonicalEventErrorOrigin(event) {
    if (event.response.errorOrigin)
        return event.response.errorOrigin;
    if (!("attempts" in event))
        return undefined;
    const finalAttempt = event.attempts.find((attempt) => attempt.finalSelected);
    if (finalAttempt?.errorOrigin)
        return finalAttempt.errorOrigin;
    return event.attempts.find((attempt) => attempt.errorOrigin)?.errorOrigin;
}
function usageCategoriesFromV1(event) {
    return [
        { category: "input", tokens: event.usage.input },
        { category: "output", tokens: event.usage.output },
        ...(event.usage.cache?.read !== undefined
            ? [{ category: "cached", tokens: event.usage.cache.read }]
            : []),
        ...(event.usage.cache?.creation !== undefined
            ? [{ category: "cache_creation", tokens: event.usage.cache.creation }]
            : []),
    ];
}
//# sourceMappingURL=canonical-event.js.map