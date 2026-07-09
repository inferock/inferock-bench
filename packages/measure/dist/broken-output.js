import { createHash } from "node:crypto";
import { getJsonSchemaValidator, getOutputSchema, getOutputValidator, simplifyAjvErrors, } from "./output-schemas.js";
import { billedEmptyEvidence, buildLossSignal, hasProviderNativeRefusalOrContentFilter, isBilledButEmpty, refundableCandidateEconomics, } from "./signal.js";
const TRUNCATED_FINISH_REASONS = new Set([
    "length",
    "max_tokens",
    "model_context_window_exceeded",
]);
const CALLER_MAX_TOKEN_FIELDS = [
    { field: "maxTokens", param: "max_tokens" },
    { field: "maxOutputTokens", param: "max_output_tokens" },
    { field: "maxCompletionTokens", param: "max_completion_tokens" },
    { field: "max_tokens", param: "max_tokens" },
    { field: "max_output_tokens", param: "max_output_tokens" },
    { field: "max_completion_tokens", param: "max_completion_tokens" },
];
function parseJsonContent(content) {
    try {
        return { ok: true, value: JSON.parse(content) };
    }
    catch {
        return { ok: false };
    }
}
function isTruncated(event) {
    return TRUNCATED_FINISH_REASONS.has(event.response.finishReason);
}
function truncationGate(event) {
    const cap = callerMaxTokenCap(event);
    const callerCapEvidence = callerCapEvidenceForEvent(event, cap);
    if (event.response.finishReason === "model_context_window_exceeded") {
        return {
            refundable: false,
            liabilityParty: "unknown",
            evidence: truncationEvidence(event, {
                ...callerCapEvidence,
                verdict: "model_context_window_exceeded_triage",
                callerCapVerdict: callerCapEvidence.verdict,
                recoverability: "triage_only_context_window_input_envelope",
            }),
        };
    }
    if (cap && event.usage.output >= cap.value) {
        return {
            refundable: false,
            liabilityParty: "customer",
            evidence: truncationEvidence(event, {
                ...callerCapEvidence,
                verdict: "caller_cap_hit",
                recoverability: "triage_only_caller_cap_hit",
            }),
        };
    }
    return {
        refundable: true,
        evidence: truncationEvidence(event, callerCapEvidence),
    };
}
function truncationEvidence(event, callerCapEvidence) {
    return {
        finishReason: event.response.finishReason,
        outputTokens: event.usage.output,
        ...callerCapEvidence,
        ...(event.request.provider === "anthropic" &&
            event.response.finishReason === "model_context_window_exceeded"
            ? {
                provider: "anthropic",
                documentationUrl: "https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons",
                apiReferenceEnumNote: "documented live stop_reason; SDK/API enum typing may lag",
            }
            : {}),
    };
}
function callerCapEvidenceForEvent(event, cap) {
    const generationCaptured = Object.prototype.hasOwnProperty.call(event.request, "generation");
    if (!cap) {
        return {
            generationCaptured,
            callerCapCaptured: false,
            verdict: "no_captured_caller_cap",
        };
    }
    const evidence = {
        generationCaptured,
        callerCapCaptured: true,
        callerMaxTokens: cap.value,
        callerMaxField: cap.field,
        callerMaxParam: cap.param,
        verdict: event.usage.output < cap.value
            ? "provider_stopped_before_caller_cap"
            : "caller_cap_hit",
    };
    if (cap.candidates.length > 1)
        evidence.callerMaxCandidates = cap.candidates;
    return evidence;
}
function callerMaxTokenCap(event) {
    const generation = event.request.generation;
    if (!generation)
        return null;
    const candidates = CALLER_MAX_TOKEN_FIELDS.flatMap(({ field, param }) => {
        const value = positiveFiniteNumber(generation[field]);
        return value === null ? [] : [{ field, param, value }];
    });
    if (candidates.length === 0)
        return null;
    const [selected] = [...candidates].sort((left, right) => left.value - right.value || left.field.localeCompare(right.field));
    return {
        ...selected,
        candidates,
    };
}
function positiveFiniteNumber(value) {
    const numeric = typeof value === "number"
        ? value
        : typeof value === "string" && value.trim().length > 0
            ? Number(value)
            : NaN;
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}
export function detectBrokenOutput(event) {
    if (isBilledButEmpty(event)) {
        return buildLossSignal({
            code: "BILLED_EMPTY",
            detector: "broken-output",
            event,
            failureClass: "empty_output",
            ...refundableCandidateEconomics(event),
            evidence: billedEmptyEvidence(event),
        });
    }
    if (isTruncated(event)) {
        const gate = truncationGate(event);
        return buildLossSignal({
            code: "TRUNCATED",
            detector: "broken-output",
            event,
            failureClass: gate.refundable ? "truncation" : null,
            ...(gate.refundable
                ? refundableCandidateEconomics(event)
                : {
                    status: "triage_only",
                    evidenceGrade: "triage_only",
                    severity: "warning",
                    creditCandidate: false,
                    dispute: false,
                    liabilityParty: gate.liabilityParty ?? "unknown",
                    valueKind: "triage",
                    recoverableBasis: null,
                    observedChargeUsd: null,
                    expectedChargeUsd: null,
                    providerRecoverableLossUsd: 0,
                    pricingVersion: null,
                    pricingStatus: "not_priced",
                }),
            evidence: gate.evidence,
        });
    }
    const outputSchemaVersion = event.meta.outputSchemaVersion;
    if (!outputSchemaVersion)
        return null;
    const validationContext = schemaValidationContext(event, outputSchemaVersion);
    if (!validationContext.validator)
        return null;
    if (hasProviderNativeRefusalOrContentFilter(event))
        return null;
    const parsed = parseJsonContent(event.response.content);
    if (!parsed.ok) {
        return buildLossSignal({
            code: "BROKEN_OUTPUT",
            detector: "broken-output",
            event,
            failureClass: "broken_output",
            ...refundableCandidateEconomics(event),
            evidence: {
                reason: "invalid_json",
                outputSchemaVersion,
                schemaSource: validationContext.schemaSource,
                ...optionalDeltaEvidence(validationContext),
            },
        });
    }
    if (validationContext.validator(parsed.value)) {
        return validationContext.deltaEvidence
            ? buildSchemaDeltaTriageSignal(event, validationContext)
            : null;
    }
    return buildLossSignal({
        code: "BROKEN_OUTPUT",
        detector: "broken-output",
        event,
        failureClass: "broken_output",
        ...refundableCandidateEconomics(event),
        evidence: {
            reason: "schema_validation_failed",
            outputSchemaVersion,
            schemaSource: validationContext.schemaSource,
            errors: simplifyAjvErrors(validationContext.validator.errors),
            ...optionalDeltaEvidence(validationContext),
        },
    });
}
export function validateOutput(event) {
    return detectBrokenOutput(event);
}
function schemaValidationContext(event, outputSchemaVersion) {
    const registeredSchema = getOutputSchema(event.request.tenantId, outputSchemaVersion);
    const sentSchema = geminiSentResponseSchema(event);
    const sanitizationEvidence = geminiSchemaSanitizationEvidence(event);
    const deltaEvidence = sentSchema && registeredSchema
        ? registeredVsSentSchemaDelta(registeredSchema, sentSchema, sanitizationEvidence)
        : sentSchema
            ? {
                registeredSchemaAvailable: false,
                sentSchemaHash: schemaHash(sentSchema),
                sentSchemaSource: "request.generation.responseJsonSchema",
                schemaDialect: "gemini_openapi_subset",
                ...(sanitizationEvidence ? { geminiSchemaSanitization: sanitizationEvidence } : {}),
            }
            : undefined;
    if (sentSchema) {
        const sentHash = schemaHash(sentSchema);
        return {
            validator: getJsonSchemaValidator(`gemini_sent_response_schema:${sentHash}`, sentSchema),
            outputSchemaVersion,
            schemaSource: "gemini_sent_response_schema",
            ...(deltaEvidence ? { deltaEvidence } : {}),
        };
    }
    return {
        validator: getOutputValidator(event.request.tenantId, outputSchemaVersion),
        outputSchemaVersion,
        schemaSource: "registered_output_schema",
    };
}
function buildSchemaDeltaTriageSignal(event, context) {
    return buildLossSignal({
        code: "BROKEN_OUTPUT",
        detector: "broken-output",
        event,
        failureClass: null,
        status: "triage_only",
        evidenceGrade: "triage_only",
        severity: "warning",
        creditCandidate: false,
        dispute: false,
        liabilityParty: "unknown",
        valueKind: "triage",
        recoverableBasis: null,
        observedChargeUsd: null,
        expectedChargeUsd: null,
        providerRecoverableLossUsd: 0,
        pricingVersion: null,
        pricingStatus: "not_priced",
        evidence: {
            reason: "valid_under_sent_schema_registered_schema_differs",
            outputSchemaVersion: context.outputSchemaVersion,
            schemaSource: context.schemaSource,
            ...optionalDeltaEvidence(context),
        },
    });
}
function optionalDeltaEvidence(context) {
    return context.deltaEvidence
        ? { registeredVsSentSchemaDelta: context.deltaEvidence }
        : {};
}
function geminiSentResponseSchema(event) {
    if (event.request.provider !== "gemini")
        return null;
    const generation = event.request.generation;
    const direct = recordValue(generation?.responseJsonSchema) ??
        recordValue(generation?.responseSchema);
    if (direct)
        return direct;
    const generationConfig = recordValue(generation?.generationConfig);
    return recordValue(generationConfig?.responseJsonSchema) ??
        recordValue(generationConfig?.responseSchema);
}
function geminiSchemaSanitizationEvidence(event) {
    const generation = event.request.generation;
    return generation?.geminiSchemaSanitization;
}
function registeredVsSentSchemaDelta(registeredSchema, sentSchema, sanitizationEvidence) {
    const registeredSchemaHash = schemaHash(registeredSchema);
    const sentSchemaHash = schemaHash(sentSchema);
    if (registeredSchemaHash === sentSchemaHash)
        return undefined;
    return {
        registeredSchemaDiffersFromSent: true,
        registeredSchemaHash,
        sentSchemaHash,
        sentSchemaSource: "request.generation.responseJsonSchema",
        schemaDialect: "gemini_openapi_subset",
        ...(sanitizationEvidence ? { geminiSchemaSanitization: sanitizationEvidence } : {}),
    };
}
function schemaHash(value) {
    return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    if (isRecord(value)) {
        const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
function recordValue(value) {
    return isRecord(value) ? value : null;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=broken-output.js.map