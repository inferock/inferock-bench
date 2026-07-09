import { createHash } from "node:crypto";
import type { Schema } from "ajv";
import type { CanonicalEventV1, CanonicalEventV2 } from "./canonical-event.js";
import {
  getJsonSchemaValidator,
  simplifyAjvErrors,
} from "./output-schemas.js";
import { tokensBilledForEvent } from "./pricing.js";
import {
  buildLossSignal,
  refundableCandidateEconomics,
} from "./signal.js";
import type { LossSignal } from "./types.js";

type JsonRecord = Record<string, unknown>;
type ToolDeclaration = NonNullable<CanonicalEventV2["request"]["toolDeclarations"]>[number];
type TerminalStatus = CanonicalEventV2["timing"]["terminalStatus"];
type ProviderSafety = NonNullable<CanonicalEventV2["response"]["providerSafety"]>;

interface EventWithToolEvidence extends CanonicalEventV1 {
  readonly request: CanonicalEventV1["request"] & {
    readonly requestedModel?: string;
    readonly generation?: JsonRecord;
    readonly toolDeclarations?: readonly ToolDeclaration[];
  };
  readonly response: CanonicalEventV1["response"] & {
    readonly servedModel?: string;
    readonly rawToolCalls?: readonly JsonRecord[];
    readonly providerSafety?: ProviderSafety;
    readonly stopDetails?: JsonRecord;
  };
  readonly timing: CanonicalEventV1["timing"] & {
    readonly terminalStatus?: TerminalStatus;
  };
}

type ToolCallSignalCode =
  | "MALFORMED_TOOL_CALL"
  | "TOOL_CALL_SCHEMA_VIOLATION"
  | "UNDECLARED_TOOL_CALL"
  | "TOOL_CHOICE_VIOLATION"
  | "TOOL_CALL_STOP_REASON_MISMATCH";

interface ParsedToolCall {
  readonly provider: CanonicalEventV1["request"]["provider"];
  readonly providerPath: string;
  readonly rawEvidence: boolean;
  readonly rawToolCall: JsonRecord;
  readonly rawToolCallHash: string;
  readonly toolName?: string;
  readonly toolId?: string;
  readonly toolIndex?: number;
  readonly argumentsValue?: unknown;
  readonly rawArgumentsText?: string;
  readonly rawArgumentFragments?: readonly string[];
  readonly malformedReason?: string;
}

interface ToolCallEvidence {
  readonly rawToolCall: JsonRecord;
  readonly rawEvidence: boolean;
  readonly responsePath: "response.rawToolCalls" | "response.toolCalls";
}

interface ToolCallFinding {
  readonly code: ToolCallSignalCode;
  readonly evidence: JsonRecord;
  readonly refundableCandidate: boolean;
}

interface DeclarationLookup {
  readonly declarationsCaptured: boolean;
  readonly byName: ReadonlyMap<string, ToolDeclaration>;
  readonly ambiguousNames: ReadonlySet<string>;
}

const DETECTOR_NAME = "tool-call-validity" as const;
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
} as const satisfies Record<ToolCallSignalCode, string>;

const TOOL_CALL_SIGNAL_ORDER: readonly ToolCallSignalCode[] = [
  "TOOL_CHOICE_VIOLATION",
  "TOOL_CALL_STOP_REASON_MISMATCH",
  "MALFORMED_TOOL_CALL",
  "TOOL_CALL_SCHEMA_VIOLATION",
  "UNDECLARED_TOOL_CALL",
];

const INVALID_TOOL_CALL_SIGNAL_CODES = new Set<ToolCallSignalCode>([
  "MALFORMED_TOOL_CALL",
  "TOOL_CALL_SCHEMA_VIOLATION",
  "UNDECLARED_TOOL_CALL",
]);
const GEMINI_TOOL_FINISH_REASON_CODES: Readonly<Record<string, ToolCallSignalCode>> = {
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
} as const satisfies Record<ToolCallSignalCode, string>;

export function detectToolCallValidity(event: CanonicalEventV1): LossSignal[] {
  const evidenceEvent = event as EventWithToolEvidence;
  const toolCalls = toolCallEvidence(evidenceEvent);
  const declarationLookup = declarationLookupForEvent(evidenceEvent);
  const findings: ToolCallFinding[] = [
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

    if (
      parsed.toolName &&
      declarationLookup.declarationsCaptured &&
      !declaration &&
      !hasAmbiguousDeclaration
    ) {
      findings.push({
        code: "UNDECLARED_TOOL_CALL",
        evidence: undeclaredEvidence(evidenceEvent, parsed),
        refundableCandidate: false,
      });
    }

    if (
      parsed.argumentsValue !== undefined &&
      declaration &&
      !hasAmbiguousDeclaration
    ) {
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

function signalsFromFindings(
  event: CanonicalEventV1,
  findings: readonly ToolCallFinding[],
): LossSignal[] {
  const byCode = new Map<ToolCallSignalCode, ToolCallFinding[]>();
  for (const finding of findings) {
    const current = byCode.get(finding.code) ?? [];
    byCode.set(finding.code, [...current, finding]);
  }

  return TOOL_CALL_SIGNAL_ORDER.flatMap((code) => {
    const codeFindings = byCode.get(code);
    if (!codeFindings || codeFindings.length === 0) return [];
    return [signalForCode(event, code, codeFindings)];
  });
}

function signalForCode(
  event: CanonicalEventV1,
  code: ToolCallSignalCode,
  findings: readonly ToolCallFinding[],
): LossSignal {
  const hasRefundableEvidence = findings.some((finding) => finding.refundableCandidate);
  const economics = hasRefundableEvidence
    ? refundableCandidateEconomics(event)
    : {
      status: "triage_only" as const,
      evidenceGrade: "triage_only" as const,
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

function toolCallEvidence(event: EventWithToolEvidence): readonly ToolCallEvidence[] {
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

function declarationLookupForEvent(event: EventWithToolEvidence): DeclarationLookup {
  const declarations = event.request.toolDeclarations;
  if (!declarations) {
    return {
      declarationsCaptured: false,
      byName: new Map(),
      ambiguousNames: new Set(),
    };
  }

  const byName = new Map<string, ToolDeclaration>();
  const ambiguousNames = new Set<string>();
  for (const declaration of declarations) {
    const existing = byName.get(declaration.name);
    if (existing && existing.schemaHash !== declaration.schemaHash) {
      ambiguousNames.add(declaration.name);
      byName.delete(declaration.name);
      continue;
    }
    if (!ambiguousNames.has(declaration.name)) byName.set(declaration.name, declaration);
  }

  return {
    declarationsCaptured: true,
    byName,
    ambiguousNames,
  };
}

interface ToolChoiceRequirement {
  readonly kind: "any" | "named";
  readonly rawToolChoice: unknown;
  readonly requiredToolName?: string;
  readonly declarationNames: readonly string[];
}

function toolChoiceFindings(
  event: EventWithToolEvidence,
  declarationLookup: DeclarationLookup,
  toolCalls: readonly ToolCallEvidence[],
): readonly ToolCallFinding[] {
  const requirement = toolChoiceRequirement(declarationLookup);
  if (!requirement) return [];

  const parsedCalls = toolCalls.map((toolCall, index) =>
    parseProviderToolCall(event, toolCall, index)
  );
  const observedToolNames = uniqueStrings(
    parsedCalls.map((parsed) => parsed.toolName).filter((name): name is string => Boolean(name)),
  );
  const toolBlockCount = toolCalls.length;

  if (requirement.kind === "any" && toolBlockCount > 0) return [];
  if (
    requirement.kind === "named" &&
    requirement.requiredToolName &&
    observedToolNames.includes(requirement.requiredToolName)
  ) {
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

function toolChoiceRequirement(lookup: DeclarationLookup): ToolChoiceRequirement | null {
  if (!lookup.declarationsCaptured) return null;
  const declarations = [...lookup.byName.values()];
  const declarationWithChoice = declarations.find((declaration) =>
    declaration.toolChoice !== undefined
  );
  if (!declarationWithChoice) return null;

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

function stopReasonConsistencyFindings(
  event: EventWithToolEvidence,
  toolCalls: readonly ToolCallEvidence[],
): readonly ToolCallFinding[] {
  const finishReason = event.response.finishReason;
  const toolTerminalReason = finishReason === "tool_calls" || finishReason === "tool_use";
  if (!toolTerminalReason || toolCalls.length > 0) return [];

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

function parseProviderToolCall(
  event: EventWithToolEvidence,
  toolCall: ToolCallEvidence,
  index: number,
): ParsedToolCall {
  if (event.request.provider === "anthropic") return parseAnthropicToolCall(toolCall, index);
  if (event.request.provider === "gemini") return parseGeminiToolCall(toolCall, index);
  return parseOpenAiToolCall(event, toolCall, index);
}

function parseOpenAiToolCall(
  event: EventWithToolEvidence,
  toolCall: ToolCallEvidence,
  index: number,
): ParsedToolCall {
  if (isOpenAiResponsesToolCall(event, toolCall.rawToolCall)) {
    return parseOpenAiResponsesToolCall(toolCall, index);
  }
  return parseOpenAiChatToolCall(toolCall, index);
}

function isOpenAiResponsesToolCall(
  event: EventWithToolEvidence,
  rawToolCall: JsonRecord,
): boolean {
  return event.request.route === OPENAI_RESPONSES_ROUTE ||
    (event.request.toolDeclarations ?? []).some((declaration) =>
      declaration.providerSurface === OPENAI_RESPONSES_SURFACE
    ) ||
    rawToolCall.type === "function_call";
}

function parseOpenAiResponsesToolCall(
  toolCall: ToolCallEvidence,
  index: number,
): ParsedToolCall {
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
  if (!toolName) return { ...base, malformedReason: "missing_function_name" };
  if (rawArgumentsText === undefined) {
    return { ...base, malformedReason: "missing_function_arguments" };
  }

  const parsed = parseJson(rawArgumentsText);
  return parsed.ok
    ? { ...base, argumentsValue: parsed.value }
    : { ...base, malformedReason: "invalid_json" };
}

function parseOpenAiChatToolCall(toolCall: ToolCallEvidence, index: number): ParsedToolCall {
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

  if (!functionRecord) return { ...base, malformedReason: "missing_function_object" };
  if (!toolName) return { ...base, malformedReason: "missing_function_name" };
  if (rawArgumentsText === undefined) {
    return { ...base, malformedReason: "missing_function_arguments" };
  }

  const parsed = parseJson(rawArgumentsText);
  return parsed.ok
    ? { ...base, argumentsValue: parsed.value }
    : { ...base, malformedReason: "invalid_json" };
}

function parseAnthropicToolCall(toolCall: ToolCallEvidence, index: number): ParsedToolCall {
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

  if (!toolName) return { ...base, malformedReason: "missing_tool_name" };
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

function parseGeminiToolCall(toolCall: ToolCallEvidence, index: number): ParsedToolCall {
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

  if (!functionCall) return { ...base, malformedReason: "missing_function_call_object" };
  if (!toolName) return { ...base, malformedReason: "missing_function_name" };
  if (args === undefined) return { ...base, malformedReason: "missing_function_args" };
  return {
    ...base,
    argumentsValue: args,
  };
}

function baseParsedToolCall(
  provider: CanonicalEventV1["request"]["provider"],
  rawToolCall: JsonRecord,
  index: number,
  input: {
    readonly providerPath: string;
    readonly rawEvidence: boolean;
    readonly toolName?: string;
    readonly toolId?: string;
    readonly rawArgumentsText?: string;
    readonly rawArgumentFragments?: readonly string[];
  },
): ParsedToolCall {
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

type ValidationResult =
  | { readonly status: "valid" }
  | { readonly status: "invalid"; readonly errors: readonly JsonRecord[] }
  | { readonly status: "unavailable" };

function validateArguments(
  declaration: ToolDeclaration,
  value: unknown,
): ValidationResult {
  const schema = schemaFromDeclaration(declaration);
  if (!schema) return { status: "unavailable" };

  let validator: ReturnType<typeof getJsonSchemaValidator>;
  try {
    validator = getJsonSchemaValidator(declaration.schemaHash, schema);
  } catch {
    return { status: "unavailable" };
  }

  if (validator(value)) return { status: "valid" };
  return {
    status: "invalid",
    errors: simplifyAjvErrors(validator.errors).map((error) => ({ ...error })),
  };
}

function schemaFromDeclaration(declaration: ToolDeclaration): Schema | null {
  if (declaration.schema === undefined) return null;
  if (typeof declaration.schema === "boolean") return declaration.schema;
  return isRecord(declaration.schema) ? declaration.schema : null;
}

function refundableGateSatisfied(
  event: EventWithToolEvidence,
  declaration: ToolDeclaration | undefined,
  parsed: ParsedToolCall,
): boolean {
  return Boolean(
    parsed.rawEvidence &&
      declaration &&
      schemaFromDeclaration(declaration) &&
      strictApplicability(event, declaration).applies &&
      event.response.statusCode >= 200 &&
      event.response.statusCode < 300 &&
      event.timing.terminalStatus === "complete" &&
      tokensBilledForEvent(event) > 0,
  );
}

function malformedEvidence(
  event: EventWithToolEvidence,
  parsed: ParsedToolCall,
  declaration: ToolDeclaration | undefined,
  reason: string,
): JsonRecord {
  return {
    ...commonInvalidCallEvidence(event, parsed, declaration),
    parser: {
      ok: false,
      reason,
    },
  };
}

function undeclaredEvidence(event: EventWithToolEvidence, parsed: ParsedToolCall): JsonRecord {
  return {
    ...commonInvalidCallEvidence(event, parsed, undefined),
    declaration: {
      matched: false,
    },
  };
}

function schemaViolationEvidence(
  event: EventWithToolEvidence,
  parsed: ParsedToolCall,
  declaration: ToolDeclaration,
  errors: readonly JsonRecord[],
): JsonRecord {
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

function commonInvalidCallEvidence(
  event: EventWithToolEvidence,
  parsed: ParsedToolCall,
  declaration: ToolDeclaration | undefined,
): JsonRecord {
  const evidence: JsonRecord = {
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
    if (declaration.strict !== undefined) evidence.strict = declaration.strict;
    if (declaration.toolChoice !== undefined) evidence.toolChoice = declaration.toolChoice;
    if (declaration.parallelToolCalls !== undefined) {
      evidence.parallelToolCalls = declaration.parallelToolCalls;
    }
  }
  if (parsed.toolName) evidence.toolName = parsed.toolName;
  if (parsed.toolId) evidence.toolId = parsed.toolId;
  if (parsed.toolIndex !== undefined) evidence.toolIndex = parsed.toolIndex;
  const rawExcerpt = excerpt(parsed.rawArgumentsText);
  if (rawExcerpt !== undefined) {
    if (parsed.provider === "anthropic" || parsed.provider === "gemini") {
      evidence.rawInputExcerpt = rawExcerpt;
    } else {
      evidence.rawArgumentsExcerpt = rawExcerpt;
    }
  }
  if (parsed.rawArgumentFragments) {
    evidence.rawFragmentCount = parsed.rawArgumentFragments.length;
  }
  return evidence;
}

function geminiToolFinishReasonFindings(event: EventWithToolEvidence): readonly ToolCallFinding[] {
  if (event.request.provider !== "gemini") return [];
  const code = GEMINI_TOOL_FINISH_REASON_CODES[event.response.finishReason];
  if (!code) return [];
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

function strictApplicability(
  event: EventWithToolEvidence,
  declaration: ToolDeclaration | undefined,
): { readonly applies: boolean; readonly blockers: readonly string[] } {
  const blockers: string[] = [];
  if (!declaration) {
    blockers.push("missing_tool_declaration");
  } else if (declaration.strict !== true) {
    blockers.push(declaration.strict === false ? "strict_false" : "strict_not_captured_true");
  }

  if (event.response.finishReason === "length" || event.response.finishReason === "max_tokens") {
    blockers.push("max_output_tokens");
  }
  if (providerRefusalException(event)) blockers.push("provider_refusal");
  if (anthropicEagerInputStreaming(event)) blockers.push("anthropic_eager_input_streaming");
  if (openAiFineTunedParallelStrictDisabled(event, declaration)) {
    blockers.push("openai_fine_tuned_parallel_tool_calls_disable_strict");
  }

  return { applies: blockers.length === 0, blockers };
}

function providerRefusalException(event: EventWithToolEvidence): boolean {
  return event.response.finishReason === "refusal" ||
    (event.response.providerSafety ?? []).some((entry) => entry.kind === "refusal");
}

function anthropicEagerInputStreaming(event: EventWithToolEvidence): boolean {
  return event.request.provider === "anthropic" &&
    event.request.generation?.eagerInputStreaming === true;
}

function openAiFineTunedParallelStrictDisabled(
  event: EventWithToolEvidence,
  declaration: ToolDeclaration | undefined,
): boolean {
  if (event.request.provider !== "openai") return false;
  if (!isFineTunedOpenAiModel(event)) return false;
  return declaration?.parallelToolCalls !== false;
}

function isFineTunedOpenAiModel(event: EventWithToolEvidence): boolean {
  return [
    event.request.requestedModel,
    event.request.model,
    event.response.servedModel,
  ].some((model) => typeof model === "string" && model.startsWith("ft:"));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function parseJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function excerpt(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length > RAW_EXCERPT_LIMIT
    ? `${value.slice(0, RAW_EXCERPT_LIMIT)}...`
    : value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Hex(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableJsonValue(entry)]),
  );
}

export type { ToolCallSignalCode };
