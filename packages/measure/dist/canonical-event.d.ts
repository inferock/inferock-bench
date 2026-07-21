import { z } from "zod";
export declare const CanonicalProvider: z.ZodEnum<["openai", "anthropic", "gemini", "mistral", "deepseek_platform", "deepinfra", "alibaba_dashscope_us_virginia", "moonshot_kimi", "zai", "together", "groq", "openrouter"]>;
declare const ServedModelSource: z.ZodEnum<["provider_response", "adapter_fallback"]>;
export declare const CANONICAL_OPERATION_ID_MAX_LENGTH = 512;
export declare function isCanonicalOperationId(value: string): boolean;
declare const ErrorOrigin: z.ZodEnum<["local", "provider"]>;
declare const WallClockDrift: z.ZodObject<{
    kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
    wallClockElapsedMs: z.ZodNumber;
    monotonicElapsedMs: z.ZodNumber;
    driftMs: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
    wallClockElapsedMs: number;
    monotonicElapsedMs: number;
    driftMs: number;
}, {
    kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
    wallClockElapsedMs: number;
    monotonicElapsedMs: number;
    driftMs: number;
}>;
/**
 * @contract-id canonical-event-v1
 */
export declare const CanonicalEventV1: z.ZodObject<{
    request: z.ZodObject<{
        tenantId: z.ZodString;
        provider: z.ZodEnum<["openai", "anthropic", "gemini", "mistral", "deepseek_platform", "deepinfra", "alibaba_dashscope_us_virginia", "moonshot_kimi", "zai", "together", "groq", "openrouter"]>;
        model: z.ZodString;
        requestId: z.ZodString;
        expectCompletion: z.ZodOptional<z.ZodBoolean>;
        route: z.ZodOptional<z.ZodString>;
        workloadClass: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        model: string;
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        route?: string | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
    }, {
        model: string;
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        route?: string | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
    }>;
    response: z.ZodObject<{
        statusCode: z.ZodNumber;
        finishReason: z.ZodString;
        content: z.ZodString;
        toolCalls: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">>;
        errorClass: z.ZodOptional<z.ZodString>;
        errorOrigin: z.ZodOptional<z.ZodEnum<["local", "provider"]>>;
    }, "strict", z.ZodTypeAny, {
        content: string;
        statusCode: number;
        finishReason: string;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
    }, {
        content: string;
        statusCode: number;
        finishReason: string;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
    }>;
    usage: z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        cache: z.ZodOptional<z.ZodObject<{
            read: z.ZodOptional<z.ZodNumber>;
            creation: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            read?: number | undefined;
            creation?: number | undefined;
        }, {
            read?: number | undefined;
            creation?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        input: number;
        output: number;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
    }, {
        input: number;
        output: number;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
    }>;
    timing: z.ZodObject<{
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        latencyMs: z.ZodNumber;
        monotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
        monotonicClockSource: z.ZodOptional<z.ZodString>;
        wallClockDrift: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
            wallClockElapsedMs: z.ZodNumber;
            monotonicElapsedMs: z.ZodNumber;
            driftMs: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }>>;
        providerRequestStartedAt: z.ZodOptional<z.ZodString>;
        providerResponseEndedAt: z.ZodOptional<z.ZodString>;
        providerElapsedMs: z.ZodOptional<z.ZodNumber>;
        providerMonotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
        providerWallClockDrift: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
            wallClockElapsedMs: z.ZodNumber;
            monotonicElapsedMs: z.ZodNumber;
            driftMs: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }>>;
        gatewayOverheadMs: z.ZodOptional<z.ZodNumber>;
        clientConsumptionEndedAt: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
    }, {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
    }>;
    meta: z.ZodObject<{
        attemptIndex: z.ZodNumber;
        schemaVersion: z.ZodLiteral<"v1">;
        outputSchemaVersion: z.ZodOptional<z.ZodString>;
        source: z.ZodOptional<z.ZodEnum<["proxy", "drift_replay"]>>;
    }, "strict", z.ZodTypeAny, {
        attemptIndex: number;
        schemaVersion: "v1";
        source?: "proxy" | "drift_replay" | undefined;
        outputSchemaVersion?: string | undefined;
    }, {
        attemptIndex: number;
        schemaVersion: "v1";
        source?: "proxy" | "drift_replay" | undefined;
        outputSchemaVersion?: string | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    request: {
        model: string;
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        route?: string | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
    };
    response: {
        content: string;
        statusCode: number;
        finishReason: string;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
    };
    meta: {
        attemptIndex: number;
        schemaVersion: "v1";
        source?: "proxy" | "drift_replay" | undefined;
        outputSchemaVersion?: string | undefined;
    };
    usage: {
        input: number;
        output: number;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
    };
    timing: {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
    };
}, {
    request: {
        model: string;
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        route?: string | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
    };
    response: {
        content: string;
        statusCode: number;
        finishReason: string;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
    };
    meta: {
        attemptIndex: number;
        schemaVersion: "v1";
        source?: "proxy" | "drift_replay" | undefined;
        outputSchemaVersion?: string | undefined;
    };
    usage: {
        input: number;
        output: number;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
    };
    timing: {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
    };
}>;
declare const UsageCategory: z.ZodObject<{
    category: z.ZodString;
    tokens: z.ZodNumber;
    sourceField: z.ZodOptional<z.ZodString>;
    provider: z.ZodOptional<z.ZodEnum<["openai", "anthropic", "gemini", "mistral", "deepseek_platform", "deepinfra", "alibaba_dashscope_us_virginia", "moonshot_kimi", "zai", "together", "groq", "openrouter"]>>;
}, "strict", z.ZodTypeAny, {
    category: string;
    tokens: number;
    provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
    sourceField?: string | undefined;
}, {
    category: string;
    tokens: number;
    provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
    sourceField?: string | undefined;
}>;
declare const UsageSource: z.ZodEnum<["provider", "recomputed", "missing", "partial"]>;
declare const PricingStatus: z.ZodEnum<["not_priced", "priced", "pricing_unknown", "partial"]>;
declare const StreamTerminalStatus: z.ZodEnum<["complete", "error", "aborted", "unknown"]>;
declare const AttemptRecord: z.ZodObject<{
    attemptNumber: z.ZodNumber;
    provider: z.ZodEnum<["openai", "anthropic", "gemini", "mistral", "deepseek_platform", "deepinfra", "alibaba_dashscope_us_virginia", "moonshot_kimi", "zai", "together", "groq", "openrouter"]>;
    model: z.ZodString;
    status: z.ZodEnum<["success", "error", "retry", "transport_error"]>;
    timing: z.ZodObject<{
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        latencyMs: z.ZodNumber;
        monotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
        monotonicClockSource: z.ZodOptional<z.ZodString>;
        wallClockDrift: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
            wallClockElapsedMs: z.ZodNumber;
            monotonicElapsedMs: z.ZodNumber;
            driftMs: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }>>;
        providerRequestStartedAt: z.ZodOptional<z.ZodString>;
        providerResponseEndedAt: z.ZodOptional<z.ZodString>;
        providerElapsedMs: z.ZodOptional<z.ZodNumber>;
        providerMonotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
        providerWallClockDrift: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
            wallClockElapsedMs: z.ZodNumber;
            monotonicElapsedMs: z.ZodNumber;
            driftMs: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }>>;
        gatewayOverheadMs: z.ZodOptional<z.ZodNumber>;
        clientConsumptionEndedAt: z.ZodOptional<z.ZodString>;
    } & {
        firstByteAt: z.ZodOptional<z.ZodString>;
        firstTokenAt: z.ZodOptional<z.ZodString>;
        lastChunkAt: z.ZodOptional<z.ZodString>;
        timeToFirstByteMs: z.ZodOptional<z.ZodNumber>;
        timeToFirstTokenMs: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
        firstByteAt?: string | undefined;
        firstTokenAt?: string | undefined;
        lastChunkAt?: string | undefined;
        timeToFirstByteMs?: number | undefined;
        timeToFirstTokenMs?: number | undefined;
    }, {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
        firstByteAt?: string | undefined;
        firstTokenAt?: string | undefined;
        lastChunkAt?: string | undefined;
        timeToFirstByteMs?: number | undefined;
        timeToFirstTokenMs?: number | undefined;
    }>;
    errorClass: z.ZodOptional<z.ZodString>;
    errorOrigin: z.ZodOptional<z.ZodEnum<["local", "provider"]>>;
    retryReason: z.ZodOptional<z.ZodString>;
    statusCode: z.ZodOptional<z.ZodNumber>;
    providerRequestId: z.ZodOptional<z.ZodString>;
    sanitizedHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    finalSelected: z.ZodBoolean;
}, "strict", z.ZodTypeAny, {
    model: string;
    status: "error" | "success" | "retry" | "transport_error";
    provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
    timing: {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
        firstByteAt?: string | undefined;
        firstTokenAt?: string | undefined;
        lastChunkAt?: string | undefined;
        timeToFirstByteMs?: number | undefined;
        timeToFirstTokenMs?: number | undefined;
    };
    attemptNumber: number;
    finalSelected: boolean;
    statusCode?: number | undefined;
    errorClass?: string | undefined;
    errorOrigin?: "local" | "provider" | undefined;
    retryReason?: string | undefined;
    providerRequestId?: string | undefined;
    sanitizedHeaders?: Record<string, string> | undefined;
}, {
    model: string;
    status: "error" | "success" | "retry" | "transport_error";
    provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
    timing: {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
        firstByteAt?: string | undefined;
        firstTokenAt?: string | undefined;
        lastChunkAt?: string | undefined;
        timeToFirstByteMs?: number | undefined;
        timeToFirstTokenMs?: number | undefined;
    };
    attemptNumber: number;
    finalSelected: boolean;
    statusCode?: number | undefined;
    errorClass?: string | undefined;
    errorOrigin?: "local" | "provider" | undefined;
    retryReason?: string | undefined;
    providerRequestId?: string | undefined;
    sanitizedHeaders?: Record<string, string> | undefined;
}>;
/**
 * @contract-id canonical-event-v2
 */
export declare const CanonicalEventV2: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"v2">;
    request: z.ZodObject<{
        tenantId: z.ZodString;
        provider: z.ZodEnum<["openai", "anthropic", "gemini", "mistral", "deepseek_platform", "deepinfra", "alibaba_dashscope_us_virginia", "moonshot_kimi", "zai", "together", "groq", "openrouter"]>;
        requestId: z.ZodString;
        providerRequestId: z.ZodOptional<z.ZodString>;
        requestedModel: z.ZodString;
        model: z.ZodOptional<z.ZodString>;
        attemptIndex: z.ZodNumber;
        apiKeyHash: z.ZodOptional<z.ZodString>;
        operationId: z.ZodOptional<z.ZodString>;
        bodyHash: z.ZodOptional<z.ZodString>;
        bodyHashAlgorithm: z.ZodOptional<z.ZodLiteral<"sha256">>;
        bodyHashCanonicalization: z.ZodOptional<z.ZodLiteral<"normalized_json_v1">>;
        retryCorrelationId: z.ZodOptional<z.ZodString>;
        expectCompletion: z.ZodOptional<z.ZodBoolean>;
        route: z.ZodOptional<z.ZodString>;
        workloadClass: z.ZodOptional<z.ZodString>;
        outputSchemaVersion: z.ZodOptional<z.ZodString>;
        providerPlane: z.ZodOptional<z.ZodString>;
        baseUrlHost: z.ZodOptional<z.ZodString>;
        authClass: z.ZodOptional<z.ZodString>;
        endpointSupportStatus: z.ZodOptional<z.ZodEnum<["supported", "procurement_gated", "unsupported"]>>;
        endpointSupportReason: z.ZodOptional<z.ZodString>;
        generation: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        factualityContract: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        toolDeclarations: z.ZodOptional<z.ZodArray<z.ZodObject<{
            providerSurface: z.ZodString;
            name: z.ZodString;
            schemaHash: z.ZodString;
            schema: z.ZodOptional<z.ZodUnknown>;
            schemaPointer: z.ZodOptional<z.ZodString>;
            strict: z.ZodOptional<z.ZodBoolean>;
            toolChoice: z.ZodOptional<z.ZodUnknown>;
            parallelToolCalls: z.ZodOptional<z.ZodBoolean>;
        }, "strict", z.ZodTypeAny, {
            name: string;
            providerSurface: string;
            schemaHash: string;
            strict?: boolean | undefined;
            schema?: unknown;
            schemaPointer?: string | undefined;
            toolChoice?: unknown;
            parallelToolCalls?: boolean | undefined;
        }, {
            name: string;
            providerSurface: string;
            schemaHash: string;
            strict?: boolean | undefined;
            schema?: unknown;
            schemaPointer?: string | undefined;
            toolChoice?: unknown;
            parallelToolCalls?: boolean | undefined;
        }>, "many">>;
        securityContext: z.ZodOptional<z.ZodEffects<z.ZodObject<{
            captureVersion: z.ZodLiteral<"request_secret_digest_v1">;
            digestKeyId: z.ZodString;
            requestSecretDigests: z.ZodArray<z.ZodObject<{
                kind: z.ZodLiteral<"secret">;
                category: z.ZodString;
                fieldPath: z.ZodString;
                matchLength: z.ZodNumber;
                digest: z.ZodString;
                digestAlgorithm: z.ZodLiteral<"hmac-sha256">;
                digestKeyId: z.ZodString;
                digestScope: z.ZodLiteral<"event">;
                patternVersion: z.ZodLiteral<"security-governance:v0">;
            }, "strict", z.ZodTypeAny, {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }, {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }>, "many">;
            captureComplete: z.ZodBoolean;
            truncated: z.ZodBoolean;
        }, "strict", z.ZodTypeAny, {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        }, {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        }>, {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        }, {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        }>>;
        sanitizedHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strict", z.ZodTypeAny, {
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        attemptIndex: number;
        requestedModel: string;
        model?: string | undefined;
        route?: string | undefined;
        generation?: Record<string, unknown> | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
        outputSchemaVersion?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        apiKeyHash?: string | undefined;
        operationId?: string | undefined;
        bodyHash?: string | undefined;
        bodyHashAlgorithm?: "sha256" | undefined;
        bodyHashCanonicalization?: "normalized_json_v1" | undefined;
        retryCorrelationId?: string | undefined;
        providerPlane?: string | undefined;
        baseUrlHost?: string | undefined;
        authClass?: string | undefined;
        endpointSupportStatus?: "supported" | "unsupported" | "procurement_gated" | undefined;
        endpointSupportReason?: string | undefined;
        factualityContract?: Record<string, unknown> | undefined;
        toolDeclarations?: {
            name: string;
            providerSurface: string;
            schemaHash: string;
            strict?: boolean | undefined;
            schema?: unknown;
            schemaPointer?: string | undefined;
            toolChoice?: unknown;
            parallelToolCalls?: boolean | undefined;
        }[] | undefined;
        securityContext?: {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        } | undefined;
    }, {
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        attemptIndex: number;
        requestedModel: string;
        model?: string | undefined;
        route?: string | undefined;
        generation?: Record<string, unknown> | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
        outputSchemaVersion?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        apiKeyHash?: string | undefined;
        operationId?: string | undefined;
        bodyHash?: string | undefined;
        bodyHashAlgorithm?: "sha256" | undefined;
        bodyHashCanonicalization?: "normalized_json_v1" | undefined;
        retryCorrelationId?: string | undefined;
        providerPlane?: string | undefined;
        baseUrlHost?: string | undefined;
        authClass?: string | undefined;
        endpointSupportStatus?: "supported" | "unsupported" | "procurement_gated" | undefined;
        endpointSupportReason?: string | undefined;
        factualityContract?: Record<string, unknown> | undefined;
        toolDeclarations?: {
            name: string;
            providerSurface: string;
            schemaHash: string;
            strict?: boolean | undefined;
            schema?: unknown;
            schemaPointer?: string | undefined;
            toolChoice?: unknown;
            parallelToolCalls?: boolean | undefined;
        }[] | undefined;
        securityContext?: {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        } | undefined;
    }>;
    response: z.ZodObject<{
        statusCode: z.ZodNumber;
        finishReason: z.ZodString;
        content: z.ZodString;
        toolCalls: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">>;
        rawToolCalls: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">>;
        servedModel: z.ZodString;
        providerRequestId: z.ZodOptional<z.ZodString>;
        providerResponseId: z.ZodOptional<z.ZodString>;
        rawObjectId: z.ZodOptional<z.ZodString>;
        systemFingerprint: z.ZodOptional<z.ZodString>;
        serviceTier: z.ZodOptional<z.ZodString>;
        servedModelSource: z.ZodOptional<z.ZodEnum<["provider_response", "adapter_fallback"]>>;
        sanitizedHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        rawErrorType: z.ZodOptional<z.ZodString>;
        rawErrorCode: z.ZodOptional<z.ZodString>;
        stopDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        providerSafety: z.ZodOptional<z.ZodArray<z.ZodObject<{
            kind: z.ZodEnum<["refusal", "content_filter", "safety", "moderation"]>;
            source: z.ZodOptional<z.ZodString>;
            reason: z.ZodOptional<z.ZodString>;
            raw: z.ZodOptional<z.ZodUnknown>;
        }, "strict", z.ZodTypeAny, {
            kind: "safety" | "refusal" | "content_filter" | "moderation";
            raw?: unknown;
            source?: string | undefined;
            reason?: string | undefined;
        }, {
            kind: "safety" | "refusal" | "content_filter" | "moderation";
            raw?: unknown;
            source?: string | undefined;
            reason?: string | undefined;
        }>, "many">>;
        citations: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">>;
        grounding: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        logprobs: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">>;
        errorClass: z.ZodOptional<z.ZodString>;
        errorOrigin: z.ZodOptional<z.ZodEnum<["local", "provider"]>>;
    }, "strict", z.ZodTypeAny, {
        content: string;
        statusCode: number;
        finishReason: string;
        servedModel: string;
        citations?: Record<string, unknown>[] | undefined;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        rawToolCalls?: Record<string, unknown>[] | undefined;
        providerResponseId?: string | undefined;
        rawObjectId?: string | undefined;
        systemFingerprint?: string | undefined;
        serviceTier?: string | undefined;
        servedModelSource?: "provider_response" | "adapter_fallback" | undefined;
        rawErrorType?: string | undefined;
        rawErrorCode?: string | undefined;
        stopDetails?: Record<string, unknown> | undefined;
        providerSafety?: {
            kind: "safety" | "refusal" | "content_filter" | "moderation";
            raw?: unknown;
            source?: string | undefined;
            reason?: string | undefined;
        }[] | undefined;
        grounding?: Record<string, unknown> | undefined;
        logprobs?: Record<string, unknown>[] | undefined;
    }, {
        content: string;
        statusCode: number;
        finishReason: string;
        servedModel: string;
        citations?: Record<string, unknown>[] | undefined;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        rawToolCalls?: Record<string, unknown>[] | undefined;
        providerResponseId?: string | undefined;
        rawObjectId?: string | undefined;
        systemFingerprint?: string | undefined;
        serviceTier?: string | undefined;
        servedModelSource?: "provider_response" | "adapter_fallback" | undefined;
        rawErrorType?: string | undefined;
        rawErrorCode?: string | undefined;
        stopDetails?: Record<string, unknown> | undefined;
        providerSafety?: {
            kind: "safety" | "refusal" | "content_filter" | "moderation";
            raw?: unknown;
            source?: string | undefined;
            reason?: string | undefined;
        }[] | undefined;
        grounding?: Record<string, unknown> | undefined;
        logprobs?: Record<string, unknown>[] | undefined;
    }>;
    usage: z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        cache: z.ZodOptional<z.ZodObject<{
            read: z.ZodOptional<z.ZodNumber>;
            creation: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            read?: number | undefined;
            creation?: number | undefined;
        }, {
            read?: number | undefined;
            creation?: number | undefined;
        }>>;
    } & {
        raw: z.ZodOptional<z.ZodUnknown>;
        categories: z.ZodArray<z.ZodObject<{
            category: z.ZodString;
            tokens: z.ZodNumber;
            sourceField: z.ZodOptional<z.ZodString>;
            provider: z.ZodOptional<z.ZodEnum<["openai", "anthropic", "gemini", "mistral", "deepseek_platform", "deepinfra", "alibaba_dashscope_us_virginia", "moonshot_kimi", "zai", "together", "groq", "openrouter"]>>;
        }, "strict", z.ZodTypeAny, {
            category: string;
            tokens: number;
            provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
            sourceField?: string | undefined;
        }, {
            category: string;
            tokens: number;
            provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
            sourceField?: string | undefined;
        }>, "many">;
        usageSource: z.ZodEnum<["provider", "recomputed", "missing", "partial"]>;
        pricingStatus: z.ZodOptional<z.ZodEnum<["not_priced", "priced", "pricing_unknown", "partial"]>>;
        serviceTier: z.ZodOptional<z.ZodString>;
        inferenceGeo: z.ZodOptional<z.ZodString>;
        iterations: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        input: number;
        output: number;
        categories: {
            category: string;
            tokens: number;
            provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
            sourceField?: string | undefined;
        }[];
        usageSource: "partial" | "missing" | "provider" | "recomputed";
        raw?: unknown;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
        iterations?: number | undefined;
        serviceTier?: string | undefined;
        pricingStatus?: "partial" | "not_priced" | "priced" | "pricing_unknown" | undefined;
        inferenceGeo?: string | undefined;
    }, {
        input: number;
        output: number;
        categories: {
            category: string;
            tokens: number;
            provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
            sourceField?: string | undefined;
        }[];
        usageSource: "partial" | "missing" | "provider" | "recomputed";
        raw?: unknown;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
        iterations?: number | undefined;
        serviceTier?: string | undefined;
        pricingStatus?: "partial" | "not_priced" | "priced" | "pricing_unknown" | undefined;
        inferenceGeo?: string | undefined;
    }>;
    timing: z.ZodObject<{
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        latencyMs: z.ZodNumber;
        monotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
        monotonicClockSource: z.ZodOptional<z.ZodString>;
        wallClockDrift: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
            wallClockElapsedMs: z.ZodNumber;
            monotonicElapsedMs: z.ZodNumber;
            driftMs: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }>>;
        providerRequestStartedAt: z.ZodOptional<z.ZodString>;
        providerResponseEndedAt: z.ZodOptional<z.ZodString>;
        providerElapsedMs: z.ZodOptional<z.ZodNumber>;
        providerMonotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
        providerWallClockDrift: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
            wallClockElapsedMs: z.ZodNumber;
            monotonicElapsedMs: z.ZodNumber;
            driftMs: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }>>;
        gatewayOverheadMs: z.ZodOptional<z.ZodNumber>;
        clientConsumptionEndedAt: z.ZodOptional<z.ZodString>;
    } & {
        firstEventAt: z.ZodOptional<z.ZodString>;
        firstContentDeltaAt: z.ZodOptional<z.ZodString>;
        firstByteAt: z.ZodOptional<z.ZodString>;
        firstTokenAt: z.ZodOptional<z.ZodString>;
        lastChunkAt: z.ZodOptional<z.ZodString>;
        timeToFirstEventMs: z.ZodOptional<z.ZodNumber>;
        timeToFirstContentDeltaMs: z.ZodOptional<z.ZodNumber>;
        timeToFirstByteMs: z.ZodOptional<z.ZodNumber>;
        timeToFirstTokenMs: z.ZodOptional<z.ZodNumber>;
        chunkCount: z.ZodNumber;
        maxInterChunkGapMs: z.ZodOptional<z.ZodNumber>;
        maxStreamGapMs: z.ZodOptional<z.ZodNumber>;
        terminalStatus: z.ZodEnum<["complete", "error", "aborted", "unknown"]>;
    }, "strict", z.ZodTypeAny, {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        chunkCount: number;
        terminalStatus: "error" | "complete" | "unknown" | "aborted";
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
        firstEventAt?: string | undefined;
        firstContentDeltaAt?: string | undefined;
        firstByteAt?: string | undefined;
        firstTokenAt?: string | undefined;
        lastChunkAt?: string | undefined;
        timeToFirstEventMs?: number | undefined;
        timeToFirstContentDeltaMs?: number | undefined;
        timeToFirstByteMs?: number | undefined;
        timeToFirstTokenMs?: number | undefined;
        maxInterChunkGapMs?: number | undefined;
        maxStreamGapMs?: number | undefined;
    }, {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        chunkCount: number;
        terminalStatus: "error" | "complete" | "unknown" | "aborted";
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
        firstEventAt?: string | undefined;
        firstContentDeltaAt?: string | undefined;
        firstByteAt?: string | undefined;
        firstTokenAt?: string | undefined;
        lastChunkAt?: string | undefined;
        timeToFirstEventMs?: number | undefined;
        timeToFirstContentDeltaMs?: number | undefined;
        timeToFirstByteMs?: number | undefined;
        timeToFirstTokenMs?: number | undefined;
        maxInterChunkGapMs?: number | undefined;
        maxStreamGapMs?: number | undefined;
    }>;
    attempts: z.ZodArray<z.ZodObject<{
        attemptNumber: z.ZodNumber;
        provider: z.ZodEnum<["openai", "anthropic", "gemini", "mistral", "deepseek_platform", "deepinfra", "alibaba_dashscope_us_virginia", "moonshot_kimi", "zai", "together", "groq", "openrouter"]>;
        model: z.ZodString;
        status: z.ZodEnum<["success", "error", "retry", "transport_error"]>;
        timing: z.ZodObject<{
            startedAt: z.ZodString;
            endedAt: z.ZodString;
            latencyMs: z.ZodNumber;
            monotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
            monotonicClockSource: z.ZodOptional<z.ZodString>;
            wallClockDrift: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
                wallClockElapsedMs: z.ZodNumber;
                monotonicElapsedMs: z.ZodNumber;
                driftMs: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            }, {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            }>>;
            providerRequestStartedAt: z.ZodOptional<z.ZodString>;
            providerResponseEndedAt: z.ZodOptional<z.ZodString>;
            providerElapsedMs: z.ZodOptional<z.ZodNumber>;
            providerMonotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
            providerWallClockDrift: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
                wallClockElapsedMs: z.ZodNumber;
                monotonicElapsedMs: z.ZodNumber;
                driftMs: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            }, {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            }>>;
            gatewayOverheadMs: z.ZodOptional<z.ZodNumber>;
            clientConsumptionEndedAt: z.ZodOptional<z.ZodString>;
        } & {
            firstByteAt: z.ZodOptional<z.ZodString>;
            firstTokenAt: z.ZodOptional<z.ZodString>;
            lastChunkAt: z.ZodOptional<z.ZodString>;
            timeToFirstByteMs: z.ZodOptional<z.ZodNumber>;
            timeToFirstTokenMs: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            startedAt: string;
            endedAt: string;
            latencyMs: number;
            monotonicElapsedMs?: number | undefined;
            monotonicClockSource?: string | undefined;
            wallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            providerRequestStartedAt?: string | undefined;
            providerResponseEndedAt?: string | undefined;
            providerElapsedMs?: number | undefined;
            providerMonotonicElapsedMs?: number | undefined;
            providerWallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            gatewayOverheadMs?: number | undefined;
            clientConsumptionEndedAt?: string | undefined;
            firstByteAt?: string | undefined;
            firstTokenAt?: string | undefined;
            lastChunkAt?: string | undefined;
            timeToFirstByteMs?: number | undefined;
            timeToFirstTokenMs?: number | undefined;
        }, {
            startedAt: string;
            endedAt: string;
            latencyMs: number;
            monotonicElapsedMs?: number | undefined;
            monotonicClockSource?: string | undefined;
            wallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            providerRequestStartedAt?: string | undefined;
            providerResponseEndedAt?: string | undefined;
            providerElapsedMs?: number | undefined;
            providerMonotonicElapsedMs?: number | undefined;
            providerWallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            gatewayOverheadMs?: number | undefined;
            clientConsumptionEndedAt?: string | undefined;
            firstByteAt?: string | undefined;
            firstTokenAt?: string | undefined;
            lastChunkAt?: string | undefined;
            timeToFirstByteMs?: number | undefined;
            timeToFirstTokenMs?: number | undefined;
        }>;
        errorClass: z.ZodOptional<z.ZodString>;
        errorOrigin: z.ZodOptional<z.ZodEnum<["local", "provider"]>>;
        retryReason: z.ZodOptional<z.ZodString>;
        statusCode: z.ZodOptional<z.ZodNumber>;
        providerRequestId: z.ZodOptional<z.ZodString>;
        sanitizedHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        finalSelected: z.ZodBoolean;
    }, "strict", z.ZodTypeAny, {
        model: string;
        status: "error" | "success" | "retry" | "transport_error";
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        timing: {
            startedAt: string;
            endedAt: string;
            latencyMs: number;
            monotonicElapsedMs?: number | undefined;
            monotonicClockSource?: string | undefined;
            wallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            providerRequestStartedAt?: string | undefined;
            providerResponseEndedAt?: string | undefined;
            providerElapsedMs?: number | undefined;
            providerMonotonicElapsedMs?: number | undefined;
            providerWallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            gatewayOverheadMs?: number | undefined;
            clientConsumptionEndedAt?: string | undefined;
            firstByteAt?: string | undefined;
            firstTokenAt?: string | undefined;
            lastChunkAt?: string | undefined;
            timeToFirstByteMs?: number | undefined;
            timeToFirstTokenMs?: number | undefined;
        };
        attemptNumber: number;
        finalSelected: boolean;
        statusCode?: number | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        retryReason?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
    }, {
        model: string;
        status: "error" | "success" | "retry" | "transport_error";
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        timing: {
            startedAt: string;
            endedAt: string;
            latencyMs: number;
            monotonicElapsedMs?: number | undefined;
            monotonicClockSource?: string | undefined;
            wallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            providerRequestStartedAt?: string | undefined;
            providerResponseEndedAt?: string | undefined;
            providerElapsedMs?: number | undefined;
            providerMonotonicElapsedMs?: number | undefined;
            providerWallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            gatewayOverheadMs?: number | undefined;
            clientConsumptionEndedAt?: string | undefined;
            firstByteAt?: string | undefined;
            firstTokenAt?: string | undefined;
            lastChunkAt?: string | undefined;
            timeToFirstByteMs?: number | undefined;
            timeToFirstTokenMs?: number | undefined;
        };
        attemptNumber: number;
        finalSelected: boolean;
        statusCode?: number | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        retryReason?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
    }>, "many">;
    retrieval: z.ZodOptional<z.ZodObject<{
        context: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">;
    }, "strict", z.ZodTypeAny, {
        context: Record<string, unknown>[];
    }, {
        context: Record<string, unknown>[];
    }>>;
}, "strict", z.ZodTypeAny, {
    request: {
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        attemptIndex: number;
        requestedModel: string;
        model?: string | undefined;
        route?: string | undefined;
        generation?: Record<string, unknown> | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
        outputSchemaVersion?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        apiKeyHash?: string | undefined;
        operationId?: string | undefined;
        bodyHash?: string | undefined;
        bodyHashAlgorithm?: "sha256" | undefined;
        bodyHashCanonicalization?: "normalized_json_v1" | undefined;
        retryCorrelationId?: string | undefined;
        providerPlane?: string | undefined;
        baseUrlHost?: string | undefined;
        authClass?: string | undefined;
        endpointSupportStatus?: "supported" | "unsupported" | "procurement_gated" | undefined;
        endpointSupportReason?: string | undefined;
        factualityContract?: Record<string, unknown> | undefined;
        toolDeclarations?: {
            name: string;
            providerSurface: string;
            schemaHash: string;
            strict?: boolean | undefined;
            schema?: unknown;
            schemaPointer?: string | undefined;
            toolChoice?: unknown;
            parallelToolCalls?: boolean | undefined;
        }[] | undefined;
        securityContext?: {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        } | undefined;
    };
    response: {
        content: string;
        statusCode: number;
        finishReason: string;
        servedModel: string;
        citations?: Record<string, unknown>[] | undefined;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        rawToolCalls?: Record<string, unknown>[] | undefined;
        providerResponseId?: string | undefined;
        rawObjectId?: string | undefined;
        systemFingerprint?: string | undefined;
        serviceTier?: string | undefined;
        servedModelSource?: "provider_response" | "adapter_fallback" | undefined;
        rawErrorType?: string | undefined;
        rawErrorCode?: string | undefined;
        stopDetails?: Record<string, unknown> | undefined;
        providerSafety?: {
            kind: "safety" | "refusal" | "content_filter" | "moderation";
            raw?: unknown;
            source?: string | undefined;
            reason?: string | undefined;
        }[] | undefined;
        grounding?: Record<string, unknown> | undefined;
        logprobs?: Record<string, unknown>[] | undefined;
    };
    usage: {
        input: number;
        output: number;
        categories: {
            category: string;
            tokens: number;
            provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
            sourceField?: string | undefined;
        }[];
        usageSource: "partial" | "missing" | "provider" | "recomputed";
        raw?: unknown;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
        iterations?: number | undefined;
        serviceTier?: string | undefined;
        pricingStatus?: "partial" | "not_priced" | "priced" | "pricing_unknown" | undefined;
        inferenceGeo?: string | undefined;
    };
    timing: {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        chunkCount: number;
        terminalStatus: "error" | "complete" | "unknown" | "aborted";
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
        firstEventAt?: string | undefined;
        firstContentDeltaAt?: string | undefined;
        firstByteAt?: string | undefined;
        firstTokenAt?: string | undefined;
        lastChunkAt?: string | undefined;
        timeToFirstEventMs?: number | undefined;
        timeToFirstContentDeltaMs?: number | undefined;
        timeToFirstByteMs?: number | undefined;
        timeToFirstTokenMs?: number | undefined;
        maxInterChunkGapMs?: number | undefined;
        maxStreamGapMs?: number | undefined;
    };
    attempts: {
        model: string;
        status: "error" | "success" | "retry" | "transport_error";
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        timing: {
            startedAt: string;
            endedAt: string;
            latencyMs: number;
            monotonicElapsedMs?: number | undefined;
            monotonicClockSource?: string | undefined;
            wallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            providerRequestStartedAt?: string | undefined;
            providerResponseEndedAt?: string | undefined;
            providerElapsedMs?: number | undefined;
            providerMonotonicElapsedMs?: number | undefined;
            providerWallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            gatewayOverheadMs?: number | undefined;
            clientConsumptionEndedAt?: string | undefined;
            firstByteAt?: string | undefined;
            firstTokenAt?: string | undefined;
            lastChunkAt?: string | undefined;
            timeToFirstByteMs?: number | undefined;
            timeToFirstTokenMs?: number | undefined;
        };
        attemptNumber: number;
        finalSelected: boolean;
        statusCode?: number | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        retryReason?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
    }[];
    schemaVersion: "v2";
    retrieval?: {
        context: Record<string, unknown>[];
    } | undefined;
}, {
    request: {
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        attemptIndex: number;
        requestedModel: string;
        model?: string | undefined;
        route?: string | undefined;
        generation?: Record<string, unknown> | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
        outputSchemaVersion?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        apiKeyHash?: string | undefined;
        operationId?: string | undefined;
        bodyHash?: string | undefined;
        bodyHashAlgorithm?: "sha256" | undefined;
        bodyHashCanonicalization?: "normalized_json_v1" | undefined;
        retryCorrelationId?: string | undefined;
        providerPlane?: string | undefined;
        baseUrlHost?: string | undefined;
        authClass?: string | undefined;
        endpointSupportStatus?: "supported" | "unsupported" | "procurement_gated" | undefined;
        endpointSupportReason?: string | undefined;
        factualityContract?: Record<string, unknown> | undefined;
        toolDeclarations?: {
            name: string;
            providerSurface: string;
            schemaHash: string;
            strict?: boolean | undefined;
            schema?: unknown;
            schemaPointer?: string | undefined;
            toolChoice?: unknown;
            parallelToolCalls?: boolean | undefined;
        }[] | undefined;
        securityContext?: {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        } | undefined;
    };
    response: {
        content: string;
        statusCode: number;
        finishReason: string;
        servedModel: string;
        citations?: Record<string, unknown>[] | undefined;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        rawToolCalls?: Record<string, unknown>[] | undefined;
        providerResponseId?: string | undefined;
        rawObjectId?: string | undefined;
        systemFingerprint?: string | undefined;
        serviceTier?: string | undefined;
        servedModelSource?: "provider_response" | "adapter_fallback" | undefined;
        rawErrorType?: string | undefined;
        rawErrorCode?: string | undefined;
        stopDetails?: Record<string, unknown> | undefined;
        providerSafety?: {
            kind: "safety" | "refusal" | "content_filter" | "moderation";
            raw?: unknown;
            source?: string | undefined;
            reason?: string | undefined;
        }[] | undefined;
        grounding?: Record<string, unknown> | undefined;
        logprobs?: Record<string, unknown>[] | undefined;
    };
    usage: {
        input: number;
        output: number;
        categories: {
            category: string;
            tokens: number;
            provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
            sourceField?: string | undefined;
        }[];
        usageSource: "partial" | "missing" | "provider" | "recomputed";
        raw?: unknown;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
        iterations?: number | undefined;
        serviceTier?: string | undefined;
        pricingStatus?: "partial" | "not_priced" | "priced" | "pricing_unknown" | undefined;
        inferenceGeo?: string | undefined;
    };
    timing: {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        chunkCount: number;
        terminalStatus: "error" | "complete" | "unknown" | "aborted";
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
        firstEventAt?: string | undefined;
        firstContentDeltaAt?: string | undefined;
        firstByteAt?: string | undefined;
        firstTokenAt?: string | undefined;
        lastChunkAt?: string | undefined;
        timeToFirstEventMs?: number | undefined;
        timeToFirstContentDeltaMs?: number | undefined;
        timeToFirstByteMs?: number | undefined;
        timeToFirstTokenMs?: number | undefined;
        maxInterChunkGapMs?: number | undefined;
        maxStreamGapMs?: number | undefined;
    };
    attempts: {
        model: string;
        status: "error" | "success" | "retry" | "transport_error";
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        timing: {
            startedAt: string;
            endedAt: string;
            latencyMs: number;
            monotonicElapsedMs?: number | undefined;
            monotonicClockSource?: string | undefined;
            wallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            providerRequestStartedAt?: string | undefined;
            providerResponseEndedAt?: string | undefined;
            providerElapsedMs?: number | undefined;
            providerMonotonicElapsedMs?: number | undefined;
            providerWallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            gatewayOverheadMs?: number | undefined;
            clientConsumptionEndedAt?: string | undefined;
            firstByteAt?: string | undefined;
            firstTokenAt?: string | undefined;
            lastChunkAt?: string | undefined;
            timeToFirstByteMs?: number | undefined;
            timeToFirstTokenMs?: number | undefined;
        };
        attemptNumber: number;
        finalSelected: boolean;
        statusCode?: number | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        retryReason?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
    }[];
    schemaVersion: "v2";
    retrieval?: {
        context: Record<string, unknown>[];
    } | undefined;
}>;
export declare const CanonicalEventAny: z.ZodUnion<[z.ZodObject<{
    schemaVersion: z.ZodLiteral<"v2">;
    request: z.ZodObject<{
        tenantId: z.ZodString;
        provider: z.ZodEnum<["openai", "anthropic", "gemini", "mistral", "deepseek_platform", "deepinfra", "alibaba_dashscope_us_virginia", "moonshot_kimi", "zai", "together", "groq", "openrouter"]>;
        requestId: z.ZodString;
        providerRequestId: z.ZodOptional<z.ZodString>;
        requestedModel: z.ZodString;
        model: z.ZodOptional<z.ZodString>;
        attemptIndex: z.ZodNumber;
        apiKeyHash: z.ZodOptional<z.ZodString>;
        operationId: z.ZodOptional<z.ZodString>;
        bodyHash: z.ZodOptional<z.ZodString>;
        bodyHashAlgorithm: z.ZodOptional<z.ZodLiteral<"sha256">>;
        bodyHashCanonicalization: z.ZodOptional<z.ZodLiteral<"normalized_json_v1">>;
        retryCorrelationId: z.ZodOptional<z.ZodString>;
        expectCompletion: z.ZodOptional<z.ZodBoolean>;
        route: z.ZodOptional<z.ZodString>;
        workloadClass: z.ZodOptional<z.ZodString>;
        outputSchemaVersion: z.ZodOptional<z.ZodString>;
        providerPlane: z.ZodOptional<z.ZodString>;
        baseUrlHost: z.ZodOptional<z.ZodString>;
        authClass: z.ZodOptional<z.ZodString>;
        endpointSupportStatus: z.ZodOptional<z.ZodEnum<["supported", "procurement_gated", "unsupported"]>>;
        endpointSupportReason: z.ZodOptional<z.ZodString>;
        generation: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        factualityContract: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        toolDeclarations: z.ZodOptional<z.ZodArray<z.ZodObject<{
            providerSurface: z.ZodString;
            name: z.ZodString;
            schemaHash: z.ZodString;
            schema: z.ZodOptional<z.ZodUnknown>;
            schemaPointer: z.ZodOptional<z.ZodString>;
            strict: z.ZodOptional<z.ZodBoolean>;
            toolChoice: z.ZodOptional<z.ZodUnknown>;
            parallelToolCalls: z.ZodOptional<z.ZodBoolean>;
        }, "strict", z.ZodTypeAny, {
            name: string;
            providerSurface: string;
            schemaHash: string;
            strict?: boolean | undefined;
            schema?: unknown;
            schemaPointer?: string | undefined;
            toolChoice?: unknown;
            parallelToolCalls?: boolean | undefined;
        }, {
            name: string;
            providerSurface: string;
            schemaHash: string;
            strict?: boolean | undefined;
            schema?: unknown;
            schemaPointer?: string | undefined;
            toolChoice?: unknown;
            parallelToolCalls?: boolean | undefined;
        }>, "many">>;
        securityContext: z.ZodOptional<z.ZodEffects<z.ZodObject<{
            captureVersion: z.ZodLiteral<"request_secret_digest_v1">;
            digestKeyId: z.ZodString;
            requestSecretDigests: z.ZodArray<z.ZodObject<{
                kind: z.ZodLiteral<"secret">;
                category: z.ZodString;
                fieldPath: z.ZodString;
                matchLength: z.ZodNumber;
                digest: z.ZodString;
                digestAlgorithm: z.ZodLiteral<"hmac-sha256">;
                digestKeyId: z.ZodString;
                digestScope: z.ZodLiteral<"event">;
                patternVersion: z.ZodLiteral<"security-governance:v0">;
            }, "strict", z.ZodTypeAny, {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }, {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }>, "many">;
            captureComplete: z.ZodBoolean;
            truncated: z.ZodBoolean;
        }, "strict", z.ZodTypeAny, {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        }, {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        }>, {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        }, {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        }>>;
        sanitizedHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strict", z.ZodTypeAny, {
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        attemptIndex: number;
        requestedModel: string;
        model?: string | undefined;
        route?: string | undefined;
        generation?: Record<string, unknown> | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
        outputSchemaVersion?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        apiKeyHash?: string | undefined;
        operationId?: string | undefined;
        bodyHash?: string | undefined;
        bodyHashAlgorithm?: "sha256" | undefined;
        bodyHashCanonicalization?: "normalized_json_v1" | undefined;
        retryCorrelationId?: string | undefined;
        providerPlane?: string | undefined;
        baseUrlHost?: string | undefined;
        authClass?: string | undefined;
        endpointSupportStatus?: "supported" | "unsupported" | "procurement_gated" | undefined;
        endpointSupportReason?: string | undefined;
        factualityContract?: Record<string, unknown> | undefined;
        toolDeclarations?: {
            name: string;
            providerSurface: string;
            schemaHash: string;
            strict?: boolean | undefined;
            schema?: unknown;
            schemaPointer?: string | undefined;
            toolChoice?: unknown;
            parallelToolCalls?: boolean | undefined;
        }[] | undefined;
        securityContext?: {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        } | undefined;
    }, {
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        attemptIndex: number;
        requestedModel: string;
        model?: string | undefined;
        route?: string | undefined;
        generation?: Record<string, unknown> | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
        outputSchemaVersion?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        apiKeyHash?: string | undefined;
        operationId?: string | undefined;
        bodyHash?: string | undefined;
        bodyHashAlgorithm?: "sha256" | undefined;
        bodyHashCanonicalization?: "normalized_json_v1" | undefined;
        retryCorrelationId?: string | undefined;
        providerPlane?: string | undefined;
        baseUrlHost?: string | undefined;
        authClass?: string | undefined;
        endpointSupportStatus?: "supported" | "unsupported" | "procurement_gated" | undefined;
        endpointSupportReason?: string | undefined;
        factualityContract?: Record<string, unknown> | undefined;
        toolDeclarations?: {
            name: string;
            providerSurface: string;
            schemaHash: string;
            strict?: boolean | undefined;
            schema?: unknown;
            schemaPointer?: string | undefined;
            toolChoice?: unknown;
            parallelToolCalls?: boolean | undefined;
        }[] | undefined;
        securityContext?: {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        } | undefined;
    }>;
    response: z.ZodObject<{
        statusCode: z.ZodNumber;
        finishReason: z.ZodString;
        content: z.ZodString;
        toolCalls: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">>;
        rawToolCalls: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">>;
        servedModel: z.ZodString;
        providerRequestId: z.ZodOptional<z.ZodString>;
        providerResponseId: z.ZodOptional<z.ZodString>;
        rawObjectId: z.ZodOptional<z.ZodString>;
        systemFingerprint: z.ZodOptional<z.ZodString>;
        serviceTier: z.ZodOptional<z.ZodString>;
        servedModelSource: z.ZodOptional<z.ZodEnum<["provider_response", "adapter_fallback"]>>;
        sanitizedHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        rawErrorType: z.ZodOptional<z.ZodString>;
        rawErrorCode: z.ZodOptional<z.ZodString>;
        stopDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        providerSafety: z.ZodOptional<z.ZodArray<z.ZodObject<{
            kind: z.ZodEnum<["refusal", "content_filter", "safety", "moderation"]>;
            source: z.ZodOptional<z.ZodString>;
            reason: z.ZodOptional<z.ZodString>;
            raw: z.ZodOptional<z.ZodUnknown>;
        }, "strict", z.ZodTypeAny, {
            kind: "safety" | "refusal" | "content_filter" | "moderation";
            raw?: unknown;
            source?: string | undefined;
            reason?: string | undefined;
        }, {
            kind: "safety" | "refusal" | "content_filter" | "moderation";
            raw?: unknown;
            source?: string | undefined;
            reason?: string | undefined;
        }>, "many">>;
        citations: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">>;
        grounding: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        logprobs: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">>;
        errorClass: z.ZodOptional<z.ZodString>;
        errorOrigin: z.ZodOptional<z.ZodEnum<["local", "provider"]>>;
    }, "strict", z.ZodTypeAny, {
        content: string;
        statusCode: number;
        finishReason: string;
        servedModel: string;
        citations?: Record<string, unknown>[] | undefined;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        rawToolCalls?: Record<string, unknown>[] | undefined;
        providerResponseId?: string | undefined;
        rawObjectId?: string | undefined;
        systemFingerprint?: string | undefined;
        serviceTier?: string | undefined;
        servedModelSource?: "provider_response" | "adapter_fallback" | undefined;
        rawErrorType?: string | undefined;
        rawErrorCode?: string | undefined;
        stopDetails?: Record<string, unknown> | undefined;
        providerSafety?: {
            kind: "safety" | "refusal" | "content_filter" | "moderation";
            raw?: unknown;
            source?: string | undefined;
            reason?: string | undefined;
        }[] | undefined;
        grounding?: Record<string, unknown> | undefined;
        logprobs?: Record<string, unknown>[] | undefined;
    }, {
        content: string;
        statusCode: number;
        finishReason: string;
        servedModel: string;
        citations?: Record<string, unknown>[] | undefined;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        rawToolCalls?: Record<string, unknown>[] | undefined;
        providerResponseId?: string | undefined;
        rawObjectId?: string | undefined;
        systemFingerprint?: string | undefined;
        serviceTier?: string | undefined;
        servedModelSource?: "provider_response" | "adapter_fallback" | undefined;
        rawErrorType?: string | undefined;
        rawErrorCode?: string | undefined;
        stopDetails?: Record<string, unknown> | undefined;
        providerSafety?: {
            kind: "safety" | "refusal" | "content_filter" | "moderation";
            raw?: unknown;
            source?: string | undefined;
            reason?: string | undefined;
        }[] | undefined;
        grounding?: Record<string, unknown> | undefined;
        logprobs?: Record<string, unknown>[] | undefined;
    }>;
    usage: z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        cache: z.ZodOptional<z.ZodObject<{
            read: z.ZodOptional<z.ZodNumber>;
            creation: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            read?: number | undefined;
            creation?: number | undefined;
        }, {
            read?: number | undefined;
            creation?: number | undefined;
        }>>;
    } & {
        raw: z.ZodOptional<z.ZodUnknown>;
        categories: z.ZodArray<z.ZodObject<{
            category: z.ZodString;
            tokens: z.ZodNumber;
            sourceField: z.ZodOptional<z.ZodString>;
            provider: z.ZodOptional<z.ZodEnum<["openai", "anthropic", "gemini", "mistral", "deepseek_platform", "deepinfra", "alibaba_dashscope_us_virginia", "moonshot_kimi", "zai", "together", "groq", "openrouter"]>>;
        }, "strict", z.ZodTypeAny, {
            category: string;
            tokens: number;
            provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
            sourceField?: string | undefined;
        }, {
            category: string;
            tokens: number;
            provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
            sourceField?: string | undefined;
        }>, "many">;
        usageSource: z.ZodEnum<["provider", "recomputed", "missing", "partial"]>;
        pricingStatus: z.ZodOptional<z.ZodEnum<["not_priced", "priced", "pricing_unknown", "partial"]>>;
        serviceTier: z.ZodOptional<z.ZodString>;
        inferenceGeo: z.ZodOptional<z.ZodString>;
        iterations: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        input: number;
        output: number;
        categories: {
            category: string;
            tokens: number;
            provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
            sourceField?: string | undefined;
        }[];
        usageSource: "partial" | "missing" | "provider" | "recomputed";
        raw?: unknown;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
        iterations?: number | undefined;
        serviceTier?: string | undefined;
        pricingStatus?: "partial" | "not_priced" | "priced" | "pricing_unknown" | undefined;
        inferenceGeo?: string | undefined;
    }, {
        input: number;
        output: number;
        categories: {
            category: string;
            tokens: number;
            provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
            sourceField?: string | undefined;
        }[];
        usageSource: "partial" | "missing" | "provider" | "recomputed";
        raw?: unknown;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
        iterations?: number | undefined;
        serviceTier?: string | undefined;
        pricingStatus?: "partial" | "not_priced" | "priced" | "pricing_unknown" | undefined;
        inferenceGeo?: string | undefined;
    }>;
    timing: z.ZodObject<{
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        latencyMs: z.ZodNumber;
        monotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
        monotonicClockSource: z.ZodOptional<z.ZodString>;
        wallClockDrift: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
            wallClockElapsedMs: z.ZodNumber;
            monotonicElapsedMs: z.ZodNumber;
            driftMs: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }>>;
        providerRequestStartedAt: z.ZodOptional<z.ZodString>;
        providerResponseEndedAt: z.ZodOptional<z.ZodString>;
        providerElapsedMs: z.ZodOptional<z.ZodNumber>;
        providerMonotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
        providerWallClockDrift: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
            wallClockElapsedMs: z.ZodNumber;
            monotonicElapsedMs: z.ZodNumber;
            driftMs: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }>>;
        gatewayOverheadMs: z.ZodOptional<z.ZodNumber>;
        clientConsumptionEndedAt: z.ZodOptional<z.ZodString>;
    } & {
        firstEventAt: z.ZodOptional<z.ZodString>;
        firstContentDeltaAt: z.ZodOptional<z.ZodString>;
        firstByteAt: z.ZodOptional<z.ZodString>;
        firstTokenAt: z.ZodOptional<z.ZodString>;
        lastChunkAt: z.ZodOptional<z.ZodString>;
        timeToFirstEventMs: z.ZodOptional<z.ZodNumber>;
        timeToFirstContentDeltaMs: z.ZodOptional<z.ZodNumber>;
        timeToFirstByteMs: z.ZodOptional<z.ZodNumber>;
        timeToFirstTokenMs: z.ZodOptional<z.ZodNumber>;
        chunkCount: z.ZodNumber;
        maxInterChunkGapMs: z.ZodOptional<z.ZodNumber>;
        maxStreamGapMs: z.ZodOptional<z.ZodNumber>;
        terminalStatus: z.ZodEnum<["complete", "error", "aborted", "unknown"]>;
    }, "strict", z.ZodTypeAny, {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        chunkCount: number;
        terminalStatus: "error" | "complete" | "unknown" | "aborted";
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
        firstEventAt?: string | undefined;
        firstContentDeltaAt?: string | undefined;
        firstByteAt?: string | undefined;
        firstTokenAt?: string | undefined;
        lastChunkAt?: string | undefined;
        timeToFirstEventMs?: number | undefined;
        timeToFirstContentDeltaMs?: number | undefined;
        timeToFirstByteMs?: number | undefined;
        timeToFirstTokenMs?: number | undefined;
        maxInterChunkGapMs?: number | undefined;
        maxStreamGapMs?: number | undefined;
    }, {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        chunkCount: number;
        terminalStatus: "error" | "complete" | "unknown" | "aborted";
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
        firstEventAt?: string | undefined;
        firstContentDeltaAt?: string | undefined;
        firstByteAt?: string | undefined;
        firstTokenAt?: string | undefined;
        lastChunkAt?: string | undefined;
        timeToFirstEventMs?: number | undefined;
        timeToFirstContentDeltaMs?: number | undefined;
        timeToFirstByteMs?: number | undefined;
        timeToFirstTokenMs?: number | undefined;
        maxInterChunkGapMs?: number | undefined;
        maxStreamGapMs?: number | undefined;
    }>;
    attempts: z.ZodArray<z.ZodObject<{
        attemptNumber: z.ZodNumber;
        provider: z.ZodEnum<["openai", "anthropic", "gemini", "mistral", "deepseek_platform", "deepinfra", "alibaba_dashscope_us_virginia", "moonshot_kimi", "zai", "together", "groq", "openrouter"]>;
        model: z.ZodString;
        status: z.ZodEnum<["success", "error", "retry", "transport_error"]>;
        timing: z.ZodObject<{
            startedAt: z.ZodString;
            endedAt: z.ZodString;
            latencyMs: z.ZodNumber;
            monotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
            monotonicClockSource: z.ZodOptional<z.ZodString>;
            wallClockDrift: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
                wallClockElapsedMs: z.ZodNumber;
                monotonicElapsedMs: z.ZodNumber;
                driftMs: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            }, {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            }>>;
            providerRequestStartedAt: z.ZodOptional<z.ZodString>;
            providerResponseEndedAt: z.ZodOptional<z.ZodString>;
            providerElapsedMs: z.ZodOptional<z.ZodNumber>;
            providerMonotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
            providerWallClockDrift: z.ZodOptional<z.ZodObject<{
                kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
                wallClockElapsedMs: z.ZodNumber;
                monotonicElapsedMs: z.ZodNumber;
                driftMs: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            }, {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            }>>;
            gatewayOverheadMs: z.ZodOptional<z.ZodNumber>;
            clientConsumptionEndedAt: z.ZodOptional<z.ZodString>;
        } & {
            firstByteAt: z.ZodOptional<z.ZodString>;
            firstTokenAt: z.ZodOptional<z.ZodString>;
            lastChunkAt: z.ZodOptional<z.ZodString>;
            timeToFirstByteMs: z.ZodOptional<z.ZodNumber>;
            timeToFirstTokenMs: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            startedAt: string;
            endedAt: string;
            latencyMs: number;
            monotonicElapsedMs?: number | undefined;
            monotonicClockSource?: string | undefined;
            wallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            providerRequestStartedAt?: string | undefined;
            providerResponseEndedAt?: string | undefined;
            providerElapsedMs?: number | undefined;
            providerMonotonicElapsedMs?: number | undefined;
            providerWallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            gatewayOverheadMs?: number | undefined;
            clientConsumptionEndedAt?: string | undefined;
            firstByteAt?: string | undefined;
            firstTokenAt?: string | undefined;
            lastChunkAt?: string | undefined;
            timeToFirstByteMs?: number | undefined;
            timeToFirstTokenMs?: number | undefined;
        }, {
            startedAt: string;
            endedAt: string;
            latencyMs: number;
            monotonicElapsedMs?: number | undefined;
            monotonicClockSource?: string | undefined;
            wallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            providerRequestStartedAt?: string | undefined;
            providerResponseEndedAt?: string | undefined;
            providerElapsedMs?: number | undefined;
            providerMonotonicElapsedMs?: number | undefined;
            providerWallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            gatewayOverheadMs?: number | undefined;
            clientConsumptionEndedAt?: string | undefined;
            firstByteAt?: string | undefined;
            firstTokenAt?: string | undefined;
            lastChunkAt?: string | undefined;
            timeToFirstByteMs?: number | undefined;
            timeToFirstTokenMs?: number | undefined;
        }>;
        errorClass: z.ZodOptional<z.ZodString>;
        errorOrigin: z.ZodOptional<z.ZodEnum<["local", "provider"]>>;
        retryReason: z.ZodOptional<z.ZodString>;
        statusCode: z.ZodOptional<z.ZodNumber>;
        providerRequestId: z.ZodOptional<z.ZodString>;
        sanitizedHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        finalSelected: z.ZodBoolean;
    }, "strict", z.ZodTypeAny, {
        model: string;
        status: "error" | "success" | "retry" | "transport_error";
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        timing: {
            startedAt: string;
            endedAt: string;
            latencyMs: number;
            monotonicElapsedMs?: number | undefined;
            monotonicClockSource?: string | undefined;
            wallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            providerRequestStartedAt?: string | undefined;
            providerResponseEndedAt?: string | undefined;
            providerElapsedMs?: number | undefined;
            providerMonotonicElapsedMs?: number | undefined;
            providerWallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            gatewayOverheadMs?: number | undefined;
            clientConsumptionEndedAt?: string | undefined;
            firstByteAt?: string | undefined;
            firstTokenAt?: string | undefined;
            lastChunkAt?: string | undefined;
            timeToFirstByteMs?: number | undefined;
            timeToFirstTokenMs?: number | undefined;
        };
        attemptNumber: number;
        finalSelected: boolean;
        statusCode?: number | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        retryReason?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
    }, {
        model: string;
        status: "error" | "success" | "retry" | "transport_error";
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        timing: {
            startedAt: string;
            endedAt: string;
            latencyMs: number;
            monotonicElapsedMs?: number | undefined;
            monotonicClockSource?: string | undefined;
            wallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            providerRequestStartedAt?: string | undefined;
            providerResponseEndedAt?: string | undefined;
            providerElapsedMs?: number | undefined;
            providerMonotonicElapsedMs?: number | undefined;
            providerWallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            gatewayOverheadMs?: number | undefined;
            clientConsumptionEndedAt?: string | undefined;
            firstByteAt?: string | undefined;
            firstTokenAt?: string | undefined;
            lastChunkAt?: string | undefined;
            timeToFirstByteMs?: number | undefined;
            timeToFirstTokenMs?: number | undefined;
        };
        attemptNumber: number;
        finalSelected: boolean;
        statusCode?: number | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        retryReason?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
    }>, "many">;
    retrieval: z.ZodOptional<z.ZodObject<{
        context: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">;
    }, "strict", z.ZodTypeAny, {
        context: Record<string, unknown>[];
    }, {
        context: Record<string, unknown>[];
    }>>;
}, "strict", z.ZodTypeAny, {
    request: {
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        attemptIndex: number;
        requestedModel: string;
        model?: string | undefined;
        route?: string | undefined;
        generation?: Record<string, unknown> | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
        outputSchemaVersion?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        apiKeyHash?: string | undefined;
        operationId?: string | undefined;
        bodyHash?: string | undefined;
        bodyHashAlgorithm?: "sha256" | undefined;
        bodyHashCanonicalization?: "normalized_json_v1" | undefined;
        retryCorrelationId?: string | undefined;
        providerPlane?: string | undefined;
        baseUrlHost?: string | undefined;
        authClass?: string | undefined;
        endpointSupportStatus?: "supported" | "unsupported" | "procurement_gated" | undefined;
        endpointSupportReason?: string | undefined;
        factualityContract?: Record<string, unknown> | undefined;
        toolDeclarations?: {
            name: string;
            providerSurface: string;
            schemaHash: string;
            strict?: boolean | undefined;
            schema?: unknown;
            schemaPointer?: string | undefined;
            toolChoice?: unknown;
            parallelToolCalls?: boolean | undefined;
        }[] | undefined;
        securityContext?: {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        } | undefined;
    };
    response: {
        content: string;
        statusCode: number;
        finishReason: string;
        servedModel: string;
        citations?: Record<string, unknown>[] | undefined;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        rawToolCalls?: Record<string, unknown>[] | undefined;
        providerResponseId?: string | undefined;
        rawObjectId?: string | undefined;
        systemFingerprint?: string | undefined;
        serviceTier?: string | undefined;
        servedModelSource?: "provider_response" | "adapter_fallback" | undefined;
        rawErrorType?: string | undefined;
        rawErrorCode?: string | undefined;
        stopDetails?: Record<string, unknown> | undefined;
        providerSafety?: {
            kind: "safety" | "refusal" | "content_filter" | "moderation";
            raw?: unknown;
            source?: string | undefined;
            reason?: string | undefined;
        }[] | undefined;
        grounding?: Record<string, unknown> | undefined;
        logprobs?: Record<string, unknown>[] | undefined;
    };
    usage: {
        input: number;
        output: number;
        categories: {
            category: string;
            tokens: number;
            provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
            sourceField?: string | undefined;
        }[];
        usageSource: "partial" | "missing" | "provider" | "recomputed";
        raw?: unknown;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
        iterations?: number | undefined;
        serviceTier?: string | undefined;
        pricingStatus?: "partial" | "not_priced" | "priced" | "pricing_unknown" | undefined;
        inferenceGeo?: string | undefined;
    };
    timing: {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        chunkCount: number;
        terminalStatus: "error" | "complete" | "unknown" | "aborted";
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
        firstEventAt?: string | undefined;
        firstContentDeltaAt?: string | undefined;
        firstByteAt?: string | undefined;
        firstTokenAt?: string | undefined;
        lastChunkAt?: string | undefined;
        timeToFirstEventMs?: number | undefined;
        timeToFirstContentDeltaMs?: number | undefined;
        timeToFirstByteMs?: number | undefined;
        timeToFirstTokenMs?: number | undefined;
        maxInterChunkGapMs?: number | undefined;
        maxStreamGapMs?: number | undefined;
    };
    attempts: {
        model: string;
        status: "error" | "success" | "retry" | "transport_error";
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        timing: {
            startedAt: string;
            endedAt: string;
            latencyMs: number;
            monotonicElapsedMs?: number | undefined;
            monotonicClockSource?: string | undefined;
            wallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            providerRequestStartedAt?: string | undefined;
            providerResponseEndedAt?: string | undefined;
            providerElapsedMs?: number | undefined;
            providerMonotonicElapsedMs?: number | undefined;
            providerWallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            gatewayOverheadMs?: number | undefined;
            clientConsumptionEndedAt?: string | undefined;
            firstByteAt?: string | undefined;
            firstTokenAt?: string | undefined;
            lastChunkAt?: string | undefined;
            timeToFirstByteMs?: number | undefined;
            timeToFirstTokenMs?: number | undefined;
        };
        attemptNumber: number;
        finalSelected: boolean;
        statusCode?: number | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        retryReason?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
    }[];
    schemaVersion: "v2";
    retrieval?: {
        context: Record<string, unknown>[];
    } | undefined;
}, {
    request: {
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        attemptIndex: number;
        requestedModel: string;
        model?: string | undefined;
        route?: string | undefined;
        generation?: Record<string, unknown> | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
        outputSchemaVersion?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        apiKeyHash?: string | undefined;
        operationId?: string | undefined;
        bodyHash?: string | undefined;
        bodyHashAlgorithm?: "sha256" | undefined;
        bodyHashCanonicalization?: "normalized_json_v1" | undefined;
        retryCorrelationId?: string | undefined;
        providerPlane?: string | undefined;
        baseUrlHost?: string | undefined;
        authClass?: string | undefined;
        endpointSupportStatus?: "supported" | "unsupported" | "procurement_gated" | undefined;
        endpointSupportReason?: string | undefined;
        factualityContract?: Record<string, unknown> | undefined;
        toolDeclarations?: {
            name: string;
            providerSurface: string;
            schemaHash: string;
            strict?: boolean | undefined;
            schema?: unknown;
            schemaPointer?: string | undefined;
            toolChoice?: unknown;
            parallelToolCalls?: boolean | undefined;
        }[] | undefined;
        securityContext?: {
            truncated: boolean;
            captureVersion: "request_secret_digest_v1";
            digestKeyId: string;
            requestSecretDigests: {
                category: string;
                kind: "secret";
                digest: string;
                digestKeyId: string;
                fieldPath: string;
                matchLength: number;
                digestAlgorithm: "hmac-sha256";
                digestScope: "event";
                patternVersion: "security-governance:v0";
            }[];
            captureComplete: boolean;
        } | undefined;
    };
    response: {
        content: string;
        statusCode: number;
        finishReason: string;
        servedModel: string;
        citations?: Record<string, unknown>[] | undefined;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
        rawToolCalls?: Record<string, unknown>[] | undefined;
        providerResponseId?: string | undefined;
        rawObjectId?: string | undefined;
        systemFingerprint?: string | undefined;
        serviceTier?: string | undefined;
        servedModelSource?: "provider_response" | "adapter_fallback" | undefined;
        rawErrorType?: string | undefined;
        rawErrorCode?: string | undefined;
        stopDetails?: Record<string, unknown> | undefined;
        providerSafety?: {
            kind: "safety" | "refusal" | "content_filter" | "moderation";
            raw?: unknown;
            source?: string | undefined;
            reason?: string | undefined;
        }[] | undefined;
        grounding?: Record<string, unknown> | undefined;
        logprobs?: Record<string, unknown>[] | undefined;
    };
    usage: {
        input: number;
        output: number;
        categories: {
            category: string;
            tokens: number;
            provider?: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter" | undefined;
            sourceField?: string | undefined;
        }[];
        usageSource: "partial" | "missing" | "provider" | "recomputed";
        raw?: unknown;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
        iterations?: number | undefined;
        serviceTier?: string | undefined;
        pricingStatus?: "partial" | "not_priced" | "priced" | "pricing_unknown" | undefined;
        inferenceGeo?: string | undefined;
    };
    timing: {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        chunkCount: number;
        terminalStatus: "error" | "complete" | "unknown" | "aborted";
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
        firstEventAt?: string | undefined;
        firstContentDeltaAt?: string | undefined;
        firstByteAt?: string | undefined;
        firstTokenAt?: string | undefined;
        lastChunkAt?: string | undefined;
        timeToFirstEventMs?: number | undefined;
        timeToFirstContentDeltaMs?: number | undefined;
        timeToFirstByteMs?: number | undefined;
        timeToFirstTokenMs?: number | undefined;
        maxInterChunkGapMs?: number | undefined;
        maxStreamGapMs?: number | undefined;
    };
    attempts: {
        model: string;
        status: "error" | "success" | "retry" | "transport_error";
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        timing: {
            startedAt: string;
            endedAt: string;
            latencyMs: number;
            monotonicElapsedMs?: number | undefined;
            monotonicClockSource?: string | undefined;
            wallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            providerRequestStartedAt?: string | undefined;
            providerResponseEndedAt?: string | undefined;
            providerElapsedMs?: number | undefined;
            providerMonotonicElapsedMs?: number | undefined;
            providerWallClockDrift?: {
                kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
                wallClockElapsedMs: number;
                monotonicElapsedMs: number;
                driftMs: number;
            } | undefined;
            gatewayOverheadMs?: number | undefined;
            clientConsumptionEndedAt?: string | undefined;
            firstByteAt?: string | undefined;
            firstTokenAt?: string | undefined;
            lastChunkAt?: string | undefined;
            timeToFirstByteMs?: number | undefined;
            timeToFirstTokenMs?: number | undefined;
        };
        attemptNumber: number;
        finalSelected: boolean;
        statusCode?: number | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
        retryReason?: string | undefined;
        providerRequestId?: string | undefined;
        sanitizedHeaders?: Record<string, string> | undefined;
    }[];
    schemaVersion: "v2";
    retrieval?: {
        context: Record<string, unknown>[];
    } | undefined;
}>, z.ZodEffects<z.ZodObject<Omit<{
    request: z.ZodObject<{
        tenantId: z.ZodString;
        provider: z.ZodEnum<["openai", "anthropic", "gemini", "mistral", "deepseek_platform", "deepinfra", "alibaba_dashscope_us_virginia", "moonshot_kimi", "zai", "together", "groq", "openrouter"]>;
        model: z.ZodString;
        requestId: z.ZodString;
        expectCompletion: z.ZodOptional<z.ZodBoolean>;
        route: z.ZodOptional<z.ZodString>;
        workloadClass: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        model: string;
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        route?: string | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
    }, {
        model: string;
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        route?: string | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
    }>;
    response: z.ZodObject<{
        statusCode: z.ZodNumber;
        finishReason: z.ZodString;
        content: z.ZodString;
        toolCalls: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>, "many">>;
        errorClass: z.ZodOptional<z.ZodString>;
        errorOrigin: z.ZodOptional<z.ZodEnum<["local", "provider"]>>;
    }, "strict", z.ZodTypeAny, {
        content: string;
        statusCode: number;
        finishReason: string;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
    }, {
        content: string;
        statusCode: number;
        finishReason: string;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
    }>;
    usage: z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        cache: z.ZodOptional<z.ZodObject<{
            read: z.ZodOptional<z.ZodNumber>;
            creation: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            read?: number | undefined;
            creation?: number | undefined;
        }, {
            read?: number | undefined;
            creation?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        input: number;
        output: number;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
    }, {
        input: number;
        output: number;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
    }>;
    timing: z.ZodObject<{
        startedAt: z.ZodString;
        endedAt: z.ZodString;
        latencyMs: z.ZodNumber;
        monotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
        monotonicClockSource: z.ZodOptional<z.ZodString>;
        wallClockDrift: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
            wallClockElapsedMs: z.ZodNumber;
            monotonicElapsedMs: z.ZodNumber;
            driftMs: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }>>;
        providerRequestStartedAt: z.ZodOptional<z.ZodString>;
        providerResponseEndedAt: z.ZodOptional<z.ZodString>;
        providerElapsedMs: z.ZodOptional<z.ZodNumber>;
        providerMonotonicElapsedMs: z.ZodOptional<z.ZodNumber>;
        providerWallClockDrift: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<["negative_wall_clock_elapsed", "implausible_wall_clock_drift"]>;
            wallClockElapsedMs: z.ZodNumber;
            monotonicElapsedMs: z.ZodNumber;
            driftMs: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }, {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        }>>;
        gatewayOverheadMs: z.ZodOptional<z.ZodNumber>;
        clientConsumptionEndedAt: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
    }, {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
    }>;
    meta: z.ZodObject<{
        attemptIndex: z.ZodNumber;
        schemaVersion: z.ZodLiteral<"v1">;
        outputSchemaVersion: z.ZodOptional<z.ZodString>;
        source: z.ZodOptional<z.ZodEnum<["proxy", "drift_replay"]>>;
    }, "strict", z.ZodTypeAny, {
        attemptIndex: number;
        schemaVersion: "v1";
        source?: "proxy" | "drift_replay" | undefined;
        outputSchemaVersion?: string | undefined;
    }, {
        attemptIndex: number;
        schemaVersion: "v1";
        source?: "proxy" | "drift_replay" | undefined;
        outputSchemaVersion?: string | undefined;
    }>;
}, "meta"> & {
    meta: z.ZodObject<{
        attemptIndex: z.ZodNumber;
        outputSchemaVersion: z.ZodOptional<z.ZodString>;
        source: z.ZodOptional<z.ZodEnum<["proxy", "drift_replay"]>>;
    } & {
        schemaVersion: z.ZodDefault<z.ZodLiteral<"v1">>;
    }, "strict", z.ZodTypeAny, {
        attemptIndex: number;
        schemaVersion: "v1";
        source?: "proxy" | "drift_replay" | undefined;
        outputSchemaVersion?: string | undefined;
    }, {
        attemptIndex: number;
        source?: "proxy" | "drift_replay" | undefined;
        schemaVersion?: "v1" | undefined;
        outputSchemaVersion?: string | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    request: {
        model: string;
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        route?: string | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
    };
    response: {
        content: string;
        statusCode: number;
        finishReason: string;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
    };
    meta: {
        attemptIndex: number;
        schemaVersion: "v1";
        source?: "proxy" | "drift_replay" | undefined;
        outputSchemaVersion?: string | undefined;
    };
    usage: {
        input: number;
        output: number;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
    };
    timing: {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
    };
}, {
    request: {
        model: string;
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        route?: string | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
    };
    response: {
        content: string;
        statusCode: number;
        finishReason: string;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
    };
    meta: {
        attemptIndex: number;
        source?: "proxy" | "drift_replay" | undefined;
        schemaVersion?: "v1" | undefined;
        outputSchemaVersion?: string | undefined;
    };
    usage: {
        input: number;
        output: number;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
    };
    timing: {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
    };
}>, {
    request: {
        model: string;
        provider: "together" | "openai" | "anthropic" | "gemini" | "mistral" | "deepseek_platform" | "deepinfra" | "alibaba_dashscope_us_virginia" | "moonshot_kimi" | "zai" | "groq" | "openrouter";
        tenantId: string;
        requestId: string;
        route?: string | undefined;
        expectCompletion?: boolean | undefined;
        workloadClass?: string | undefined;
    };
    response: {
        content: string;
        statusCode: number;
        finishReason: string;
        toolCalls?: Record<string, unknown>[] | undefined;
        errorClass?: string | undefined;
        errorOrigin?: "local" | "provider" | undefined;
    };
    meta: {
        attemptIndex: number;
        schemaVersion: "v1";
        source?: "proxy" | "drift_replay" | undefined;
        outputSchemaVersion?: string | undefined;
    };
    usage: {
        input: number;
        output: number;
        cache?: {
            read?: number | undefined;
            creation?: number | undefined;
        } | undefined;
    };
    timing: {
        startedAt: string;
        endedAt: string;
        latencyMs: number;
        monotonicElapsedMs?: number | undefined;
        monotonicClockSource?: string | undefined;
        wallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        providerRequestStartedAt?: string | undefined;
        providerResponseEndedAt?: string | undefined;
        providerElapsedMs?: number | undefined;
        providerMonotonicElapsedMs?: number | undefined;
        providerWallClockDrift?: {
            kind: "negative_wall_clock_elapsed" | "implausible_wall_clock_drift";
            wallClockElapsedMs: number;
            monotonicElapsedMs: number;
            driftMs: number;
        } | undefined;
        gatewayOverheadMs?: number | undefined;
        clientConsumptionEndedAt?: string | undefined;
    };
}, unknown>]>;
export type CanonicalEventV1 = z.infer<typeof CanonicalEventV1>;
export type CanonicalEventV2 = z.infer<typeof CanonicalEventV2>;
export type CanonicalEventAny = CanonicalEventV1 | CanonicalEventV2;
export type CanonicalProviderName = z.infer<typeof CanonicalProvider>;
export type ProviderName = Extract<CanonicalProviderName, "openai" | "anthropic" | "gemini" | "openrouter">;
export type CanonicalAttemptRecord = z.infer<typeof AttemptRecord>;
export type CanonicalUsageCategory = z.infer<typeof UsageCategory>;
export type CanonicalErrorOrigin = z.infer<typeof ErrorOrigin>;
export interface CanonicalEventNormalized extends CanonicalEventV1 {
    readonly schemaVersion: "v1" | "v2";
    readonly rawOriginalEvent: CanonicalEventAny;
    readonly request: CanonicalEventV1["request"] & {
        readonly requestedModel: string;
        readonly providerRequestId?: string;
        readonly attemptIndex: number;
        readonly apiKeyHash?: string;
        readonly operationId?: string;
        readonly bodyHash?: string;
        readonly bodyHashAlgorithm?: "sha256";
        readonly bodyHashCanonicalization?: "normalized_json_v1";
        readonly retryCorrelationId?: string;
        readonly route?: string;
        readonly workloadClass?: string;
        readonly outputSchemaVersion?: string;
        readonly providerPlane?: string;
        readonly baseUrlHost?: string;
        readonly authClass?: string;
        readonly endpointSupportStatus?: "supported" | "procurement_gated" | "unsupported";
        readonly endpointSupportReason?: string;
        readonly generation?: Record<string, unknown>;
        readonly factualityContract?: Record<string, unknown>;
        readonly toolDeclarations?: CanonicalEventV2["request"]["toolDeclarations"];
        readonly securityContext?: CanonicalEventV2["request"]["securityContext"];
        readonly sanitizedHeaders?: Record<string, string>;
    };
    readonly retrieval?: CanonicalEventV2["retrieval"];
    readonly response: CanonicalEventV1["response"] & {
        readonly servedModel: string;
        readonly rawToolCalls?: readonly Record<string, unknown>[];
        readonly providerRequestId?: string;
        readonly providerResponseId?: string;
        readonly rawObjectId?: string;
        readonly systemFingerprint?: string;
        readonly serviceTier?: string;
        readonly servedModelSource?: z.infer<typeof ServedModelSource>;
        readonly sanitizedHeaders?: Record<string, string>;
        readonly rawErrorType?: string;
        readonly rawErrorCode?: string;
        readonly stopDetails?: Record<string, unknown>;
        readonly providerSafety?: CanonicalEventV2["response"]["providerSafety"];
        readonly citations?: readonly Record<string, unknown>[];
        readonly grounding?: Record<string, unknown>;
        readonly logprobs?: readonly Record<string, unknown>[];
        readonly errorOrigin?: CanonicalErrorOrigin;
    };
    readonly usage: CanonicalEventV1["usage"] & {
        readonly raw?: unknown;
        readonly categories: readonly CanonicalUsageCategory[];
        readonly usageSource: z.infer<typeof UsageSource>;
        readonly pricingStatus?: z.infer<typeof PricingStatus>;
        readonly serviceTier?: string;
        readonly inferenceGeo?: string;
        readonly iterations?: number;
    };
    readonly timing: CanonicalEventV1["timing"] & {
        readonly firstEventAt?: string;
        readonly firstContentDeltaAt?: string;
        readonly firstByteAt?: string;
        readonly firstTokenAt?: string;
        readonly lastChunkAt?: string;
        readonly providerRequestStartedAt?: string;
        readonly providerResponseEndedAt?: string;
        readonly providerElapsedMs?: number;
        readonly providerMonotonicElapsedMs?: number;
        readonly providerWallClockDrift?: z.infer<typeof WallClockDrift>;
        readonly monotonicElapsedMs?: number;
        readonly monotonicClockSource?: string;
        readonly wallClockDrift?: z.infer<typeof WallClockDrift>;
        readonly gatewayOverheadMs?: number;
        readonly clientConsumptionEndedAt?: string;
        readonly timeToFirstEventMs?: number;
        readonly timeToFirstContentDeltaMs?: number;
        readonly timeToFirstByteMs?: number;
        readonly timeToFirstTokenMs?: number;
        readonly chunkCount: number;
        readonly maxInterChunkGapMs?: number;
        readonly maxStreamGapMs?: number;
        readonly terminalStatus: z.infer<typeof StreamTerminalStatus>;
    };
    readonly attempts: readonly CanonicalAttemptRecord[];
}
export declare function normalizeCanonicalEvent(event: CanonicalEventAny): CanonicalEventNormalized;
export declare function canonicalEventErrorOrigin(event: Pick<CanonicalEventNormalized, "response" | "attempts"> | Pick<CanonicalEventV2, "response" | "attempts"> | Pick<CanonicalEventV1, "response">): CanonicalErrorOrigin | undefined;
export {};
//# sourceMappingURL=canonical-event.d.ts.map