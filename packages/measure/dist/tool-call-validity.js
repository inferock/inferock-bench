import { createHash } from "node:crypto";
import { getJsonSchemaValidator, simplifyAjvErrors, } from "./output-schemas.js";
import { tokensBilledForEvent } from "./pricing.js";
import { buildLossSignal, refundableCandidateEconomics, } from "./signal.js";
const DETECTOR_NAME = "tool-call-validity";
const DETECTOR_VERSION = "v1";
const RAW_EXCERPT_LIMIT = 512;
const OPENAI_RESPONSES_ROUTE = "openai.responses";
const OPENAI_RESPONSES_SURFACE = "openai_responses";
const FAILURE_CLASS_BY_CODE = {
    MALFORMED_TOOL_CALL: "malformed_tool_call",
    TOOL_CALL_SCHEMA_VIOLATION: "tool_call_schema_violation",
    UNDECLARED_TOOL_CALL: "undeclared_tool_call",
    TOOL_CHOICE_VIOLATION: "tool_choice_violation",
    TOOL_CALL_STOP_REASON_MISMATCH: "tool_call_stop_reason_mismatch",
};
const TOOL_CALL_SIGNAL_ORDER = [
    "TOOL_CHOICE_VIOLATION",
    "TOOL_CALL_STOP_REASON_MISMATCH",
    "MALFORMED_TOOL_CALL",
    "TOOL_CALL_SCHEMA_VIOLATION",
    "UNDECLARED_TOOL_CALL",
];
const INVALID_TOOL_CALL_SIGNAL_CODES = new Set([
    "MALFORMED_TOOL_CALL",
    "TOOL_CALL_SCHEMA_VIOLATION",
    "UNDECLARED_TOOL_CALL",
]);
const GEMINI_TOOL_FINISH_REASON_CODES = {
    malformed_function_call: "MALFORMED_TOOL_CALL",
    unexpected_tool_call: "UNDECLARED_TOOL_CALL",
    too_many_tool_calls: "MALFORMED_TOOL_CALL",
    missing_thought_signature: "MALFORMED_TOOL_CALL",
};
const REASON_BY_CODE = {
    MALFORMED_TOOL_CALL: "tool_call_validation_failed",
    TOOL_CALL_SCHEMA_VIOLATION: "tool_call_validation_failed",
    UNDECLARED_TOOL_CALL: "tool_call_validation_failed",
    TOOL_CHOICE_VIOLATION: "tool_choice_violation",
    TOOL_CALL_STOP_REASON_MISMATCH: "tool_stop_reason_without_tool_block",
};
export function detectToolCallValidity(event) {
    const evidenceEvent = event;
    const toolCalls = toolCallEvidence(evidenceEvent);
    const declarationLookup = declarationLookupForEvent(evidenceEvent);
    const findings = [
        ...toolChoiceFindings(evidenceEvent, declarationLookup, toolCalls),
        ...stopReasonConsistencyFindings(evidenceEvent, toolCalls),
        ...geminiToolFinishReasonFindings(evidenceEvent),
    ];
    toolCalls.forEach((toolCall, index) => {
        const parsed = parseProviderToolCall(evidenceEvent, toolCall, index);
        const declaration = parsed.toolName
            ? declarationLookup.byName.get(parsed.toolName)
            : undefined;
        const hasAmbiguousDeclaration = parsed.toolName
            ? declarationLookup.ambiguousNames.has(parsed.toolName)
            : false;
        if (parsed.malformedReason) {
            findings.push({
                code: "MALFORMED_TOOL_CALL",
                evidence: malformedEvidence(evidenceEvent, parsed, declaration, parsed.malformedReason),
                refundableCandidate: refundableGateSatisfied(evidenceEvent, declaration, parsed),
            });
        }
        if (parsed.toolName &&
            declarationLookup.declarationsCaptured &&
            !declaration &&
            !hasAmbiguousDeclaration) {
            findings.push({
                code: "UNDECLARED_TOOL_CALL",
                evidence: undeclaredEvidence(evidenceEvent, parsed),
                refundableCandidate: false,
            });
        }
        if (parsed.argumentsValue !== undefined &&
            declaration &&
            !hasAmbiguousDeclaration) {
            const validation = validateArguments(declaration, parsed.argumentsValue);
            if (validation.status === "invalid") {
                findings.push({
                    code: "TOOL_CALL_SCHEMA_VIOLATION",
                    evidence: schemaViolationEvidence(evidenceEvent, parsed, declaration, validation.errors),
                    refundableCandidate: refundableGateSatisfied(evidenceEvent, declaration, parsed),
                });
            }
        }
    });
    return signalsFromFindings(event, findings);
}
function signalsFromFindings(event, findings) {
    const byCode = new Map();
    for (const finding of findings) {
        const current = byCode.get(finding.code) ?? [];
        byCode.set(finding.code, [...current, finding]);
    }
    return TOOL_CALL_SIGNAL_ORDER.flatMap((code) => {
        const codeFindings = byCode.get(code);
        if (!codeFindings || codeFindings.length === 0)
            return [];
        return [signalForCode(event, code, codeFindings)];
    });
}
function signalForCode(event, code, findings) {
    const hasRefundableEvidence = findings.some((finding) => finding.refundableCandidate);
    const economics = hasRefundableEvidence
        ? refundableCandidateEconomics(event)
        : {
            status: "triage_only",
            evidenceGrade: "triage_only",
            creditCandidate: false,
            expectedChargeUsd: null,
            providerRecoverableLossUsd: null,
        };
    const evidence = INVALID_TOOL_CALL_SIGNAL_CODES.has(code)
        ? {
            reason: REASON_BY_CODE[code],
            invalidCallCount: findings.length,
            invalidCalls: findings.map((finding) => finding.evidence),
        }
        : {
            reason: REASON_BY_CODE[code],
            violationCount: findings.length,
            violations: findings.map((finding) => finding.evidence),
        };
    return buildLossSignal({
        code,
        detector: DETECTOR_NAME,
        detectorVersion: DETECTOR_VERSION,
        event,
        domain: "loss",
        failureClass: FAILURE_CLASS_BY_CODE[code],
        ...economics,
        dispute: hasRefundableEvidence,
        liabilityParty: hasRefundableEvidence ? "provider" : "unknown",
        valueKind: "money",
        recoverableBasis: "whole_call",
        valueJson: { invalidCallCount: findings.length },
        evidence,
    });
}
function toolCallEvidence(event) {
    const rawToolCalls = event.response.rawToolCalls?.filter(isRecord) ?? [];
    if (rawToolCalls.length > 0) {
        return rawToolCalls.map((rawToolCall) => ({
            rawToolCall,
            rawEvidence: true,
            responsePath: "response.rawToolCalls",
        }));
    }
    return (event.response.toolCalls ?? [])
        .filter(isRecord)
        .map((rawToolCall) => ({
        rawToolCall,
        rawEvidence: false,
        responsePath: "response.toolCalls",
    }));
}
function declarationLookupForEvent(event) {
    const declarations = event.request.toolDeclarations;
    if (!declarations) {
        return {
            declarationsCaptured: false,
            byName: new Map(),
            ambiguousNames: new Set(),
        };
    }
    const byName = new Map();
    const ambiguousNames = new Set();
    for (const declaration of declarations) {
        const existing = byName.get(declaration.name);
        if (existing && existing.schemaHash !== declaration.schemaHash) {
            ambiguousNames.add(declaration.name);
            byName.delete(declaration.name);
            continue;
        }
        if (!ambiguousNames.has(declaration.name))
            byName.set(declaration.name, declaration);
    }
    return {
        declarationsCaptured: true,
        byName,
        ambiguousNames,
    };
}
function toolChoiceFindings(event, declarationLookup, toolCalls) {
    const requirement = toolChoiceRequirement(declarationLookup);
    if (!requirement)
        return [];
    const parsedCalls = toolCalls.map((toolCall, index) => parseProviderToolCall(event, toolCall, index));
    const observedToolNames = uniqueStrings(parsedCalls.map((parsed) => parsed.toolName).filter((name) => Boolean(name)));
    const toolBlockCount = toolCalls.length;
    if (requirement.kind === "any" && toolBlockCount > 0)
        return [];
    if (requirement.kind === "named" &&
        requirement.requiredToolName &&
        observedToolNames.includes(requirement.requiredToolName)) {
        return [];
    }
    return [{
            code: "TOOL_CHOICE_VIOLATION",
            refundableCandidate: false,
            evidence: {
                provider: event.request.provider,
                reason: requirement.kind === "named"
                    ? "named_tool_choice_not_satisfied"
                    : "required_tool_choice_not_satisfied",
                toolChoice: requirement.rawToolChoice,
                ...(requirement.requiredToolName ? { requiredToolName: requirement.requiredToolName } : {}),
                declarationNames: requirement.declarationNames,
                observedToolNames,
                toolBlockCount,
            },
        }];
}
function toolChoiceRequirement(lookup) {
    if (!lookup.declarationsCaptured)
        return null;
    const declarations = [...lookup.byName.values()];
    const declarationWithChoice = declarations.find((declaration) => declaration.toolChoice !== undefined);
    if (!declarationWithChoice)
        return null;
    const rawToolChoice = declarationWithChoice.toolChoice;
    const declarationNames = declarations.map((declaration) => declaration.name).sort();
    const stringChoice = stringValue(rawToolChoice);
    if (stringChoice === "required") {
        return { kind: "any", rawToolChoice, declarationNames };
    }
    const choiceRecord = asRecord(rawToolChoice);
    const choiceType = stringValue(choiceRecord?.type);
    if (choiceType === "any" || choiceType === "required") {
        return { kind: "any", rawToolChoice, declarationNames };
    }
    if (choiceType === "tool") {
        const requiredToolName = stringValue(choiceRecord?.name);
        return requiredToolName
            ? { kind: "named", rawToolChoice, requiredToolName, declarationNames }
            : null;
    }
    if (choiceType === "function") {
        const functionChoice = asRecord(choiceRecord?.function);
        const requiredToolName = stringValue(functionChoice?.name) ?? stringValue(choiceRecord?.name);
        return requiredToolName
            ? { kind: "named", rawToolChoice, requiredToolName, declarationNames }
            : null;
    }
    return null;
}
function stopReasonConsistencyFindings(event, toolCalls) {
    const finishReason = event.response.finishReason;
    const toolTerminalReason = finishReason === "tool_calls" || finishReason === "tool_use";
    if (!toolTerminalReason || toolCalls.length > 0)
        return [];
    return [{
            code: "TOOL_CALL_STOP_REASON_MISMATCH",
            refundableCandidate: false,
            evidence: {
                provider: event.request.provider,
                reason: "tool_stop_reason_without_tool_block",
                finishReason,
                rawToolCallsCaptured: event.response.rawToolCalls !== undefined,
                normalizedToolCallsCaptured: event.response.toolCalls !== undefined,
                toolBlockCount: 0,
            },
        }];
}
function parseProviderToolCall(event, toolCall, index) {
    if (event.request.provider === "anthropic")
        return parseAnthropicToolCall(toolCall, index);
    if (event.request.provider === "gemini")
        return parseGeminiToolCall(toolCall, index);
    return parseOpenAiToolCall(event, toolCall, index);
}
function parseOpenAiToolCall(event, toolCall, index) {
    if (isOpenAiResponsesToolCall(event, toolCall.rawToolCall)) {
        return parseOpenAiResponsesToolCall(toolCall, index);
    }
    return parseOpenAiChatToolCall(toolCall, index);
}
function isOpenAiResponsesToolCall(event, rawToolCall) {
    return event.request.route === OPENAI_RESPONSES_ROUTE ||
        (event.request.toolDeclarations ?? []).some((declaration) => declaration.providerSurface === OPENAI_RESPONSES_SURFACE) ||
        rawToolCall.type === "function_call";
}
function parseOpenAiResponsesToolCall(toolCall, index) {
    const rawToolCall = toolCall.rawToolCall;
    const toolName = stringValue(rawToolCall.name);
    const rawArgumentsText = stringValue(rawToolCall.arguments);
    const rawArgumentFragments = stringArray(rawToolCall.argumentFragments);
    const base = baseParsedToolCall("openai", rawToolCall, index, {
        providerPath: `${toolCall.responsePath}[${index}].arguments`,
        rawEvidence: toolCall.rawEvidence,
        toolName,
        toolId: stringValue(rawToolCall.call_id),
        rawArgumentsText,
        rawArgumentFragments,
    });
    if (rawToolCall.type !== "function_call") {
        return { ...base, malformedReason: "missing_function_call_type" };
    }
    if (!toolName)
        return { ...base, malformedReason: "missing_function_name" };
    if (rawArgumentsText === undefined) {
        return { ...base, malformedReason: "missing_function_arguments" };
    }
    const parsed = parseJson(rawArgumentsText);
    return parsed.ok
        ? { ...base, argumentsValue: parsed.value }
        : { ...base, malformedReason: "invalid_json" };
}
function parseOpenAiChatToolCall(toolCall, index) {
    const rawToolCall = toolCall.rawToolCall;
    const functionRecord = asRecord(rawToolCall.function);
    const toolName = stringValue(functionRecord?.name);
    const rawArgumentsText = stringValue(functionRecord?.arguments);
    const rawArgumentFragments = stringArray(rawToolCall.argumentFragments);
    const base = baseParsedToolCall("openai", rawToolCall, index, {
        providerPath: `${toolCall.responsePath}[${index}].function.arguments`,
        rawEvidence: toolCall.rawEvidence,
        toolName,
        rawArgumentsText,
        rawArgumentFragments,
    });
    if (!functionRecord)
        return { ...base, malformedReason: "missing_function_object" };
    if (!toolName)
        return { ...base, malformedReason: "missing_function_name" };
    if (rawArgumentsText === undefined) {
        return { ...base, malformedReason: "missing_function_arguments" };
    }
    const parsed = parseJson(rawArgumentsText);
    return parsed.ok
        ? { ...base, argumentsValue: parsed.value }
        : { ...base, malformedReason: "invalid_json" };
}
function parseAnthropicToolCall(toolCall, index) {
    const rawToolCall = toolCall.rawToolCall;
    const toolName = stringValue(rawToolCall.name);
    const inputJson = stringValue(rawToolCall.inputJson);
    const inputJsonPartials = stringArray(rawToolCall.inputJsonPartials);
    const base = baseParsedToolCall("anthropic", rawToolCall, index, {
        providerPath: inputJson !== undefined
            ? `${toolCall.responsePath}[${index}].inputJson`
            : `${toolCall.responsePath}[${index}].input`,
        rawEvidence: toolCall.rawEvidence,
        toolName,
        rawArgumentsText: inputJson,
        rawArgumentFragments: inputJsonPartials,
    });
    if (!toolName)
        return { ...base, malformedReason: "missing_tool_name" };
    if (inputJson !== undefined) {
        const parsed = parseJson(inputJson);
        return parsed.ok
            ? { ...base, argumentsValue: parsed.value }
            : { ...base, malformedReason: "invalid_json" };
    }
    if (!Object.prototype.hasOwnProperty.call(rawToolCall, "input")) {
        return { ...base, malformedReason: "missing_tool_input" };
    }
    return {
        ...base,
        argumentsValue: rawToolCall.input,
    };
}
function parseGeminiToolCall(toolCall, index) {
    const rawToolCall = toolCall.rawToolCall;
    const functionCall = asRecord(rawToolCall.functionCall);
    const toolName = stringValue(functionCall?.name) ?? stringValue(rawToolCall.name);
    const toolId = stringValue(functionCall?.id);
    const args = Object.prototype.hasOwnProperty.call(rawToolCall, "args")
        ? rawToolCall.args
        : functionCall?.args;
    const argsJson = args === undefined ? undefined : stableJson(args);
    const base = baseParsedToolCall("gemini", rawToolCall, index, {
        providerPath: `${toolCall.responsePath}[${index}].functionCall.args`,
        rawEvidence: toolCall.rawEvidence,
        toolName,
        toolId,
        rawArgumentsText: argsJson,
    });
    if (!functionCall)
        return { ...base, malformedReason: "missing_function_call_object" };
    if (!toolName)
        return { ...base, malformedReason: "missing_function_name" };
    if (args === undefined)
        return { ...base, malformedReason: "missing_function_args" };
    return {
        ...base,
        argumentsValue: args,
    };
}
function baseParsedToolCall(provider, rawToolCall, index, input) {
    return {
        provider,
        providerPath: input.providerPath,
        rawEvidence: input.rawEvidence,
        rawToolCall,
        rawToolCallHash: sha256Hex(stableJson(rawToolCall)),
        ...(input.toolName ? { toolName: input.toolName } : {}),
        ...(input.toolId ?? stringValue(rawToolCall.id)
            ? { toolId: input.toolId ?? stringValue(rawToolCall.id) }
            : {}),
        ...(numberValue(rawToolCall.index) !== undefined
            ? { toolIndex: numberValue(rawToolCall.index) }
            : { toolIndex: index }),
        ...(input.rawArgumentsText !== undefined ? { rawArgumentsText: input.rawArgumentsText } : {}),
        ...(input.rawArgumentFragments ? { rawArgumentFragments: input.rawArgumentFragments } : {}),
    };
}
function validateArguments(declaration, value) {
    const schema = schemaFromDeclaration(declaration);
    if (!schema)
        return { status: "unavailable" };
    let validator;
    try {
        validator = getJsonSchemaValidator(declaration.schemaHash, schema);
    }
    catch {
        return { status: "unavailable" };
    }
    if (validator(value))
        return { status: "valid" };
    return {
        status: "invalid",
        errors: simplifyAjvErrors(validator.errors).map((error) => ({ ...error })),
    };
}
function schemaFromDeclaration(declaration) {
    if (declaration.schema === undefined)
        return null;
    if (typeof declaration.schema === "boolean")
        return declaration.schema;
    return isRecord(declaration.schema) ? declaration.schema : null;
}
function refundableGateSatisfied(event, declaration, parsed) {
    return Boolean(parsed.rawEvidence &&
        declaration &&
        schemaFromDeclaration(declaration) &&
        strictApplicability(event, declaration).applies &&
        event.response.statusCode >= 200 &&
        event.response.statusCode < 300 &&
        event.timing.terminalStatus === "complete" &&
        tokensBilledForEvent(event) > 0);
}
function malformedEvidence(event, parsed, declaration, reason) {
    return {
        ...commonInvalidCallEvidence(event, parsed, declaration),
        parser: {
            ok: false,
            reason,
        },
    };
}
function undeclaredEvidence(event, parsed) {
    return {
        ...commonInvalidCallEvidence(event, parsed, undefined),
        declaration: {
            matched: false,
        },
    };
}
function schemaViolationEvidence(event, parsed, declaration, errors) {
    return {
        ...commonInvalidCallEvidence(event, parsed, declaration),
        parser: {
            ok: true,
        },
        validation: {
            ok: false,
            errors,
        },
    };
}
function commonInvalidCallEvidence(event, parsed, declaration) {
    const evidence = {
        provider: parsed.provider,
        providerPath: parsed.providerPath,
        rawProviderEvidence: parsed.rawEvidence,
        rawToolCallHash: parsed.rawToolCallHash,
    };
    const applicability = strictApplicability(event, declaration);
    evidence.strictApplicability = applicability.blockers.length === 0
        ? { applies: true }
        : { applies: false, blockers: applicability.blockers };
    if (declaration) {
        evidence.providerSurface = declaration.providerSurface;
        evidence.schemaHash = declaration.schemaHash;
        if (declaration.strict !== undefined)
            evidence.strict = declaration.strict;
        if (declaration.toolChoice !== undefined)
            evidence.toolChoice = declaration.toolChoice;
        if (declaration.parallelToolCalls !== undefined) {
            evidence.parallelToolCalls = declaration.parallelToolCalls;
        }
    }
    if (parsed.toolName)
        evidence.toolName = parsed.toolName;
    if (parsed.toolId)
        evidence.toolId = parsed.toolId;
    if (parsed.toolIndex !== undefined)
        evidence.toolIndex = parsed.toolIndex;
    const rawExcerpt = excerpt(parsed.rawArgumentsText);
    if (rawExcerpt !== undefined) {
        if (parsed.provider === "anthropic" || parsed.provider === "gemini") {
            evidence.rawInputExcerpt = rawExcerpt;
        }
        else {
            evidence.rawArgumentsExcerpt = rawExcerpt;
        }
    }
    if (parsed.rawArgumentFragments) {
        evidence.rawFragmentCount = parsed.rawArgumentFragments.length;
    }
    return evidence;
}
function geminiToolFinishReasonFindings(event) {
    if (event.request.provider !== "gemini")
        return [];
    const code = GEMINI_TOOL_FINISH_REASON_CODES[event.response.finishReason];
    if (!code)
        return [];
    return [{
            code,
            refundableCandidate: false,
            evidence: {
                provider: "gemini",
                reason: "gemini_tool_validity_finish_reason",
                finishReason: event.response.finishReason,
                stopDetails: event.response.stopDetails,
            },
        }];
}
function strictApplicability(event, declaration) {
    const blockers = [];
    if (!declaration) {
        blockers.push("missing_tool_declaration");
    }
    else if (declaration.strict !== true) {
        blockers.push(declaration.strict === false ? "strict_false" : "strict_not_captured_true");
    }
    if (event.response.finishReason === "length" || event.response.finishReason === "max_tokens") {
        blockers.push("max_output_tokens");
    }
    if (providerRefusalException(event))
        blockers.push("provider_refusal");
    if (anthropicEagerInputStreaming(event))
        blockers.push("anthropic_eager_input_streaming");
    if (openAiFineTunedParallelStrictDisabled(event, declaration)) {
        blockers.push("openai_fine_tuned_parallel_tool_calls_disable_strict");
    }
    return { applies: blockers.length === 0, blockers };
}
function providerRefusalException(event) {
    return event.response.finishReason === "refusal" ||
        (event.response.providerSafety ?? []).some((entry) => entry.kind === "refusal");
}
function anthropicEagerInputStreaming(event) {
    return event.request.provider === "anthropic" &&
        event.request.generation?.eagerInputStreaming === true;
}
function openAiFineTunedParallelStrictDisabled(event, declaration) {
    if (event.request.provider !== "openai")
        return false;
    if (!isFineTunedOpenAiModel(event))
        return false;
    return declaration?.parallelToolCalls !== false;
}
function isFineTunedOpenAiModel(event) {
    return [
        event.request.requestedModel,
        event.request.model,
        event.response.servedModel,
    ].some((model) => typeof model === "string" && model.startsWith("ft:"));
}
function uniqueStrings(values) {
    return [...new Set(values)].sort();
}
function parseJson(text) {
    try {
        return { ok: true, value: JSON.parse(text) };
    }
    catch {
        return { ok: false };
    }
}
function excerpt(value) {
    if (value === undefined)
        return undefined;
    return value.length > RAW_EXCERPT_LIMIT
        ? `${value.slice(0, RAW_EXCERPT_LIMIT)}...`
        : value;
}
function stringValue(value) {
    return typeof value === "string" ? value : undefined;
}
function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function stringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    return value.every((entry) => typeof entry === "string")
        ? value
        : undefined;
}
function asRecord(value) {
    return isRecord(value) ? value : undefined;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sha256Hex(value) {
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
function stableJson(value) {
    return JSON.stringify(stableJsonValue(value));
}
function stableJsonValue(value) {
    if (Array.isArray(value))
        return value.map(stableJsonValue);
    if (!isRecord(value))
        return value;
    return Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)]));
}
//# sourceMappingURL=tool-call-validity.js.map