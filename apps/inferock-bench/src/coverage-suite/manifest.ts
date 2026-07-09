import { readFile } from "node:fs/promises";
import { Ajv } from "ajv";
import { stableSha256 } from "./canonical-json.js";

/**
 * Coverage suite manifest rejection is layered.
 *
 * Structural validation below is deterministic and rejects malformed suite
 * definitions: unsupported routes, invalid tool declarations, uncompilable JSON
 * schemas, tiny token caps, and hand-authored duplicate request IDs. The content
 * deny patterns are defense-in-depth for obvious failure-manufacturing prompts;
 * string matching is not treated as complete. The authoritative v1 gate is that
 * runner-facing loads are version-controlled and hash-pinned to the checked-in
 * manifest. Arbitrary user manifests are not an input surface in v1.
 */

export type CoverageGenerator = "built-in" | "agent";
export type CoverageModelPresetPolicy = "pricing-registry-cheapest-compatible";

export interface CoverageSuiteManifestV1 {
  readonly schemaVersion: "inferock-coverage-suite-manifest-v1";
  readonly suiteVersion: "inferock-coverage-suite-v1";
  readonly methodVersion: string;
  readonly defaultGenerator: "built-in";
  readonly modelPresetPolicy: CoverageModelPresetPolicy;
  readonly estimateDefaults: {
    readonly defaultSpendCapMultiplier: number;
  };
  readonly agentMode: {
    readonly organicTaskBudget: CoverageAgentOrganicTaskBudget;
  };
  readonly tasks: readonly CoverageSuiteTask[];
  readonly surfaces: readonly CoverageSurfaceDefinition[];
}

export interface CoverageAgentOrganicTaskBudget {
  readonly corpusTaskCount: number;
  readonly lowCallsPerTask: number;
  readonly expectedCallsPerTask: number;
  readonly maxCallsPerTask: number;
  readonly maxWallTimeMsPerTask: number;
  readonly estimatedUsagePerCall: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
    readonly cacheCreation?: number;
  };
}

export interface CoverageSuiteTask {
  readonly taskId: string;
  readonly providerRoutes: readonly string[];
  readonly promptTemplate: string;
  readonly requestBody: Record<string, unknown>;
  readonly outputSchemaVersion?: string;
  readonly outputSchema?: Record<string, unknown>;
  readonly factualityContract?: {
    readonly contractId: string;
    readonly mode: "known_answer";
    readonly expectedAnswer: string | number;
    readonly matchType: "exact" | "numeric" | "date" | "entity";
    readonly authoritative: boolean;
    readonly aliases?: readonly string[];
    readonly numericTolerance?: number;
    readonly sensitive?: boolean;
  };
  readonly driftContract?: {
    readonly contractId: string;
    readonly matcher: "exact" | "semantic" | "known_answer";
    readonly repeatGroupId: string;
  };
  readonly operationIdRequired?: boolean;
  readonly concurrencyGroup?: string;
  readonly normalUsageRationale: string;
  readonly opensSurfaces: readonly string[];
}

export interface CoverageSurfaceDefinition {
  readonly surfaceId: string;
  readonly measure: string;
  readonly label: string;
  readonly detectorCodes: readonly string[];
  readonly taskIds: readonly string[];
  readonly normalUsageRationale: string;
}

export type LoadedCoverageSuiteManifest = CoverageSuiteManifestV1 & {
  readonly manifestHash: string;
};

export const coverageSuiteManifestUrl = new URL(
  "./inferock-coverage-suite-v1.json",
  import.meta.url,
);

export const CHECKED_IN_COVERAGE_SUITE_V1_MANIFEST_HASH =
  "sha256:ef7b1bab24291cec6e31fd67dcc15385fd678e085e3e3f9cd5bb7e7b34653eda";

export const immutableCoverageSuiteV1TaskIds = [
  "json_schema_extract",
  "tool_schema_plan",
  "long_stream_review",
  "shared_prefix_cache",
  "identical_rerun_drift",
  "known_answer_contract",
  "sdk_retry_idempotent",
  "concurrency_wave",
  "anthropic_message_baseline",
  "openai_responses_structured",
  "automatic_latency_token",
  "organic_safety_overlays",
] as const;

const TINY_MAX_TOKEN_THRESHOLD = 64;
const MAX_TOKEN_KEYS = new Set([
  "max_tokens",
  "max_output_tokens",
  "max_completion_tokens",
  "maxTokens",
]);

const REQUEST_ID_HEADER_KEYS = new Set([
  "x-inferock-request-id",
  "x-request-id",
]);

const SUPPORTED_PROVIDER_ROUTES = new Set([
  "openai:chat.completions",
  "openai:responses",
  "anthropic:messages",
  "gemini:gemini.generateContent",
  "openrouter:openai_compatible_chat",
]);

const TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

const FORBIDDEN_PROMPT_PATTERNS: readonly RegExp[] = [
  /\b(?:jailbreak|against\s+policy|refus(?:e|es|ed|ing|al)|declin(?:e|es|ed|ing))\b/i,
  /\b(?:exhaust|quota|rate[-\s]?limit|flood|spam|429)\b/i,
  /\bignore (?:the )?(?:previous|system|developer) instructions?\b/i,
  /\bforce (?:a )?refusal\b/i,
  /\bpolicy[- ]trigger/i,
  /\bcontent[- ]filter\b/i,
  /\bmalformed json\b/i,
  /\binvalid json\b/i,
  /\bquota exhaustion\b/i,
  /\b(?:force|induce|simulate) (?:a )?(?:429|rate limit|retry)\b/i,
  /\babort (?:the )?stream\b/i,
  /\b(?:force|induce|trigger|simulate|cause|create|manufacture|provoke|make)\b[\s\S]{0,80}\b(?:failure|error|refus(?:e|al)|declin(?:e|ed|ing)|policy|content[-\s]?filter|malformed|invalid|schema|json|quota|429|rate[-\s]?limit|retry|duplicate|abort|truncat(?:e|ion)|timeout)\b/i,
];

const JSON_SCHEMA_VALIDATOR = new Ajv({ allErrors: true, strict: true });

export async function loadCoverageSuiteManifest(
  path: string | URL = coverageSuiteManifestUrl,
): Promise<LoadedCoverageSuiteManifest> {
  const raw = await readFile(path, "utf8");
  const manifest = loadCoverageSuiteManifestFromValue(JSON.parse(raw) as unknown);
  assertCheckedInManifestHash(manifest);
  return manifest;
}

export function loadCoverageSuiteManifestFromValue(value: unknown): LoadedCoverageSuiteManifest {
  const manifest = parseCoverageSuiteManifest(value);
  validateCoverageSuiteManifest(manifest);
  return {
    ...manifest,
    manifestHash: computeCoverageSuiteManifestHash(manifest),
  };
}

export function computeCoverageSuiteManifestHash(value: unknown): string {
  return stableSha256(value);
}

function parseCoverageSuiteManifest(value: unknown): CoverageSuiteManifestV1 {
  if (!isRecord(value)) throw new Error("Coverage suite manifest must be an object.");
  if (value.schemaVersion !== "inferock-coverage-suite-manifest-v1") {
    throw new Error("Coverage suite manifest schemaVersion is invalid.");
  }
  if (value.suiteVersion !== "inferock-coverage-suite-v1") {
    throw new Error("Coverage suite manifest suiteVersion is invalid.");
  }
  if (value.defaultGenerator !== "built-in") {
    throw new Error("Coverage suite v1 defaultGenerator must be built-in.");
  }
  if (value.modelPresetPolicy !== "pricing-registry-cheapest-compatible") {
    throw new Error("Coverage suite v1 modelPresetPolicy must use the pricing registry.");
  }
  if (!isRecord(value.estimateDefaults)) {
    throw new Error("Coverage suite manifest estimateDefaults is required.");
  }
  if (!isRecord(value.agentMode)) {
    throw new Error("Coverage suite manifest agentMode is required.");
  }
  const defaultSpendCapMultiplier = numberValue(
    value.estimateDefaults.defaultSpendCapMultiplier,
  );
  if (defaultSpendCapMultiplier === undefined || defaultSpendCapMultiplier <= 1) {
    throw new Error("Coverage suite default spend cap multiplier must be greater than one.");
  }
  if (!Array.isArray(value.tasks)) throw new Error("Coverage suite tasks must be an array.");
  if (!Array.isArray(value.surfaces)) throw new Error("Coverage suite surfaces must be an array.");

  return {
    schemaVersion: value.schemaVersion,
    suiteVersion: value.suiteVersion,
    methodVersion: requiredString(value.methodVersion, "methodVersion"),
    defaultGenerator: value.defaultGenerator,
    modelPresetPolicy: value.modelPresetPolicy,
    estimateDefaults: { defaultSpendCapMultiplier },
    agentMode: {
      organicTaskBudget: parseAgentOrganicTaskBudget(value.agentMode.organicTaskBudget),
    },
    tasks: value.tasks.map(parseCoverageSuiteTask),
    surfaces: value.surfaces.map(parseCoverageSurfaceDefinition),
  };
}

function parseAgentOrganicTaskBudget(value: unknown): CoverageAgentOrganicTaskBudget {
  if (!isRecord(value)) {
    throw new Error("Coverage suite agentMode.organicTaskBudget is required.");
  }
  const corpusTaskCount = integerValue(value.corpusTaskCount, "agentMode.organicTaskBudget.corpusTaskCount");
  const lowCallsPerTask = integerValue(value.lowCallsPerTask, "agentMode.organicTaskBudget.lowCallsPerTask");
  const expectedCallsPerTask = integerValue(value.expectedCallsPerTask, "agentMode.organicTaskBudget.expectedCallsPerTask");
  const maxCallsPerTask = integerValue(value.maxCallsPerTask, "agentMode.organicTaskBudget.maxCallsPerTask");
  const maxWallTimeMsPerTask = integerValue(value.maxWallTimeMsPerTask, "agentMode.organicTaskBudget.maxWallTimeMsPerTask");
  if (corpusTaskCount <= 0) throw new Error("Coverage suite agent organic corpusTaskCount must be positive.");
  if (lowCallsPerTask < 0) throw new Error("Coverage suite agent organic lowCallsPerTask must be non-negative.");
  if (expectedCallsPerTask < lowCallsPerTask) {
    throw new Error("Coverage suite agent organic expectedCallsPerTask must be at least lowCallsPerTask.");
  }
  if (maxCallsPerTask < expectedCallsPerTask) {
    throw new Error("Coverage suite agent organic maxCallsPerTask must be at least expectedCallsPerTask.");
  }
  if (maxWallTimeMsPerTask <= 0) {
    throw new Error("Coverage suite agent organic maxWallTimeMsPerTask must be positive.");
  }
  const estimatedUsagePerCall = recordValue(
    value.estimatedUsagePerCall,
    "agentMode.organicTaskBudget.estimatedUsagePerCall",
  );
  const input = integerValue(estimatedUsagePerCall.input, "agentMode.organicTaskBudget.estimatedUsagePerCall.input");
  const output = integerValue(estimatedUsagePerCall.output, "agentMode.organicTaskBudget.estimatedUsagePerCall.output");
  const cacheRead = integerValue(estimatedUsagePerCall.cacheRead, "agentMode.organicTaskBudget.estimatedUsagePerCall.cacheRead", true);
  const cacheCreation = integerValue(estimatedUsagePerCall.cacheCreation, "agentMode.organicTaskBudget.estimatedUsagePerCall.cacheCreation", true);
  if (input <= 0 || output <= 0) {
    throw new Error("Coverage suite agent organic estimatedUsagePerCall input/output must be positive.");
  }
  return {
    corpusTaskCount,
    lowCallsPerTask,
    expectedCallsPerTask,
    maxCallsPerTask,
    maxWallTimeMsPerTask,
    estimatedUsagePerCall: {
      input,
      output,
      ...(cacheRead !== undefined ? { cacheRead } : {}),
      ...(cacheCreation !== undefined ? { cacheCreation } : {}),
    },
  };
}

function parseCoverageSuiteTask(value: unknown, index: number): CoverageSuiteTask {
  if (!isRecord(value)) throw new Error(`Coverage suite task ${index} must be an object.`);
  const requestBody = recordValue(value.requestBody, `task ${index} requestBody`);
  const task: CoverageSuiteTask = {
    taskId: requiredString(value.taskId, `task ${index} taskId`),
    providerRoutes: stringArray(value.providerRoutes, `task ${index} providerRoutes`),
    promptTemplate: requiredString(value.promptTemplate, `task ${index} promptTemplate`),
    requestBody,
    ...(stringValue(value.outputSchemaVersion)
      ? { outputSchemaVersion: stringValue(value.outputSchemaVersion) }
      : {}),
    ...(isRecord(value.outputSchema) ? { outputSchema: value.outputSchema } : {}),
    ...(isRecord(value.factualityContract)
      ? { factualityContract: parseFactualityContract(value.factualityContract, index) }
      : {}),
    ...(isRecord(value.driftContract)
      ? { driftContract: parseDriftContract(value.driftContract, index) }
      : {}),
    ...(typeof value.operationIdRequired === "boolean"
      ? { operationIdRequired: value.operationIdRequired }
      : {}),
    ...(stringValue(value.concurrencyGroup) ? { concurrencyGroup: stringValue(value.concurrencyGroup) } : {}),
    normalUsageRationale: requiredString(value.normalUsageRationale, `task ${index} normalUsageRationale`),
    opensSurfaces: stringArray(value.opensSurfaces, `task ${index} opensSurfaces`),
  };
  return task;
}

function parseFactualityContract(
  value: Record<string, unknown>,
  taskIndex: number,
): CoverageSuiteTask["factualityContract"] {
  const matchType = value.matchType;
  if (!["exact", "numeric", "date", "entity"].includes(String(matchType))) {
    throw new Error(`task ${taskIndex} factualityContract matchType is invalid.`);
  }
  return {
    contractId: requiredString(value.contractId, `task ${taskIndex} factualityContract contractId`),
    mode: "known_answer",
    expectedAnswer: requiredStringOrNumber(value.expectedAnswer, `task ${taskIndex} factualityContract expectedAnswer`),
    matchType: matchType as "exact" | "numeric" | "date" | "entity",
    authoritative: value.authoritative === true,
    ...(Array.isArray(value.aliases)
      ? { aliases: stringArray(value.aliases, `task ${taskIndex} factualityContract aliases`) }
      : {}),
    ...(numberValue(value.numericTolerance) !== undefined
      ? { numericTolerance: numberValue(value.numericTolerance) }
      : {}),
    ...(typeof value.sensitive === "boolean" ? { sensitive: value.sensitive } : {}),
  };
}

function parseDriftContract(
  value: Record<string, unknown>,
  taskIndex: number,
): CoverageSuiteTask["driftContract"] {
  const matcher = value.matcher;
  if (!["exact", "semantic", "known_answer"].includes(String(matcher))) {
    throw new Error(`task ${taskIndex} driftContract matcher is invalid.`);
  }
  return {
    contractId: requiredString(value.contractId, `task ${taskIndex} driftContract contractId`),
    matcher: matcher as "exact" | "semantic" | "known_answer",
    repeatGroupId: requiredString(value.repeatGroupId, `task ${taskIndex} driftContract repeatGroupId`),
  };
}

function parseCoverageSurfaceDefinition(value: unknown, index: number): CoverageSurfaceDefinition {
  if (!isRecord(value)) throw new Error(`Coverage surface ${index} must be an object.`);
  return {
    surfaceId: requiredString(value.surfaceId, `surface ${index} surfaceId`),
    measure: requiredString(value.measure, `surface ${index} measure`),
    label: requiredString(value.label, `surface ${index} label`),
    detectorCodes: stringArray(value.detectorCodes, `surface ${index} detectorCodes`),
    taskIds: stringArray(value.taskIds, `surface ${index} taskIds`),
    normalUsageRationale: requiredString(value.normalUsageRationale, `surface ${index} normalUsageRationale`),
  };
}

function validateCoverageSuiteManifest(manifest: CoverageSuiteManifestV1): void {
  assertImmutableTaskIds(manifest);
  assertUnique(manifest.surfaces.map((surface) => surface.surfaceId), "surface IDs");
  const surfaceIds = new Set(manifest.surfaces.map((surface) => surface.surfaceId));
  const taskIds = new Set(manifest.tasks.map((task) => task.taskId));

  for (const task of manifest.tasks) {
    validateCoverageSuiteTask(task);
    for (const surfaceId of task.opensSurfaces) {
      if (!surfaceIds.has(surfaceId)) {
        throw new Error(`Coverage suite task ${task.taskId} opens unknown surface ${surfaceId}.`);
      }
    }
  }

  for (const surface of manifest.surfaces) {
    for (const taskId of surface.taskIds) {
      if (!taskIds.has(taskId)) {
        throw new Error(`Coverage suite surface ${surface.surfaceId} references unknown task ${taskId}.`);
      }
    }
  }
}

function assertImmutableTaskIds(manifest: CoverageSuiteManifestV1): void {
  const actual = manifest.tasks.map((task) => task.taskId);
  const expected = [...immutableCoverageSuiteV1TaskIds];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Coverage suite v1 immutable task IDs changed; bump the suite version.");
  }
}

function validateCoverageSuiteTask(task: CoverageSuiteTask): void {
  if (task.providerRoutes.length === 0) {
    throw new Error(`Coverage suite task ${task.taskId} must declare provider routes.`);
  }
  if (task.opensSurfaces.length === 0) {
    throw new Error(`Coverage suite task ${task.taskId} must open at least one surface.`);
  }
  rejectForbiddenPromptText(task);
  rejectForbiddenRequestSettings(task);
  if (task.outputSchema !== undefined) validateJsonSchema(`${task.taskId} outputSchema`, task.outputSchema);
  validateRequestBodyStructure(task);
}

function assertCheckedInManifestHash(manifest: LoadedCoverageSuiteManifest): void {
  if (manifest.manifestHash !== CHECKED_IN_COVERAGE_SUITE_V1_MANIFEST_HASH) {
    throw new Error(
      `Coverage suite v1 manifest is hash-pinned; expected ${CHECKED_IN_COVERAGE_SUITE_V1_MANIFEST_HASH}, received ${manifest.manifestHash}.`,
    );
  }
}

function rejectForbiddenPromptText(task: CoverageSuiteTask): void {
  for (const pattern of FORBIDDEN_PROMPT_PATTERNS) {
    if (pattern.test(task.promptTemplate)) {
      throw new Error(`Coverage suite task ${task.taskId} contains forbidden failure-manufacturing prompt text.`);
    }
  }
}

function rejectForbiddenRequestSettings(task: CoverageSuiteTask): void {
  for (const entry of walkRecords(task.requestBody)) {
    for (const [rawKey, value] of Object.entries(entry)) {
      const key = rawKey.toLowerCase();
      if (REQUEST_ID_HEADER_KEYS.has(key)) {
        throw new Error(`Coverage suite task ${task.taskId} must not set request ID headers manually.`);
      }
      if (MAX_TOKEN_KEYS.has(rawKey) && typeof value === "number" && value > 0 && value < TINY_MAX_TOKEN_THRESHOLD) {
        throw new Error(`Coverage suite task ${task.taskId} sets a tiny max token cap.`);
      }
      if (typeof value === "string") {
        for (const pattern of FORBIDDEN_PROMPT_PATTERNS) {
          if (pattern.test(value)) {
            throw new Error(`Coverage suite task ${task.taskId} contains forbidden request text.`);
          }
        }
      }
    }
  }
}

function validateRequestBodyStructure(task: CoverageSuiteTask): void {
  for (const route of task.providerRoutes) validateRouteRequestBody(task, route);
  validateRequestSchemas(task.taskId, task.requestBody);
  validateToolDeclarations(task.taskId, task.requestBody);
}

function validateRouteRequestBody(task: CoverageSuiteTask, route: string): void {
  if (!SUPPORTED_PROVIDER_ROUTES.has(route)) {
    throw new Error(`Coverage suite task ${task.taskId} uses unsupported provider route ${route}.`);
  }
  const body = task.requestBody;
  validateOptionalTemperature(task.taskId, body.temperature);
  validateOptionalMaxTokens(task.taskId, body);
  if ("stream" in body && typeof body.stream !== "boolean") {
    throw new Error(`Coverage suite task ${task.taskId} stream must be boolean.`);
  }
  if ("metadata" in body && !isRecord(body.metadata)) {
    throw new Error(`Coverage suite task ${task.taskId} metadata must be an object.`);
  }
}

function validateOptionalTemperature(taskId: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error(`Coverage suite task ${taskId} temperature must be a finite number from 0 through 2.`);
  }
}

function validateOptionalMaxTokens(taskId: string, requestBody: Record<string, unknown>): void {
  for (const key of MAX_TOKEN_KEYS) {
    const value = requestBody[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || Number(value) <= 0) {
      throw new Error(`Coverage suite task ${taskId} ${key} must be a positive integer.`);
    }
  }
}

function validateRequestSchemas(taskId: string, requestBody: Record<string, unknown>): void {
  const responseFormat = requestBody.response_format;
  if (responseFormat === undefined) return;
  if (!isRecord(responseFormat)) throw new Error(`${taskId} response_format must be an object.`);
  if (responseFormat.type === "json_schema") {
    if (!isRecord(responseFormat.json_schema)) {
      throw new Error(`${taskId} response_format json_schema must be an object.`);
    }
    const name = stringValue(responseFormat.json_schema.name);
    if (!name || !TOOL_NAME_PATTERN.test(name)) {
      throw new Error(`${taskId} response_format json_schema name is invalid.`);
    }
    const jsonSchema = responseFormat.json_schema.schema;
    validateJsonSchema(`${taskId} response_format json_schema`, jsonSchema);
  }
  if (responseFormat.type !== "json_schema" && responseFormat.type !== "json_object") {
    throw new Error(`${taskId} response_format type is invalid.`);
  }
}

function validateToolDeclarations(taskId: string, requestBody: Record<string, unknown>): void {
  const tools = requestBody.tools;
  if (tools === undefined) {
    if (requestBody.tool_choice !== undefined) {
      throw new Error(`Coverage suite task ${taskId} tool_choice references undeclared tools.`);
    }
    return;
  }
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error(`Coverage suite task ${taskId} tools must be a non-empty array.`);
  }
  const declaredToolNames = new Set<string>();
  for (const [index, tool] of tools.entries()) {
    const name = validateToolDeclaration(taskId, tool, index);
    if (declaredToolNames.has(name)) {
      throw new Error(`Coverage suite task ${taskId} tool declaration ${name} is duplicated.`);
    }
    declaredToolNames.add(name);
  }
  for (const name of toolChoiceNames(taskId, requestBody.tool_choice)) {
    if (!declaredToolNames.has(name)) {
      throw new Error(`Coverage suite task ${taskId} references undeclared tool ${name}.`);
    }
  }
}

function validateToolDeclaration(taskId: string, value: unknown, index: number): string {
  if (!isRecord(value)) {
    throw new Error(`Coverage suite task ${taskId} tool declaration ${index} must be an object.`);
  }
  const openAiFunction = isRecord(value.function) ? value.function : undefined;
  const name = openAiFunction
    ? stringValue(openAiFunction.name)
    : stringValue(value.name);
  if (!name || !TOOL_NAME_PATTERN.test(name)) {
    throw new Error(`Coverage suite task ${taskId} tool declaration ${index} has an invalid name.`);
  }
  if (openAiFunction && value.type !== "function") {
    throw new Error(`Coverage suite task ${taskId} tool declaration ${name} must use type function.`);
  }
  const schema = openAiFunction ? openAiFunction.parameters : value.input_schema;
  const label = `Coverage suite task ${taskId} tool declaration ${name}`;
  const compiledSchema = validateJsonSchema(label, schema);
  validateCoverageSuiteToolArgumentSurface(label, compiledSchema);
  return name;
}

function toolChoiceNames(taskId: string, value: unknown): readonly string[] {
  if (value === undefined || value === "auto" || value === "none" || value === "any") return [];
  if (typeof value === "string") {
    if (!TOOL_NAME_PATTERN.test(value)) {
      throw new Error(`Coverage suite task ${taskId} tool_choice has an invalid tool name.`);
    }
    return [value];
  }
  if (!isRecord(value)) {
    throw new Error(`Coverage suite task ${taskId} tool_choice must be a supported tool choice object.`);
  }
  const type = stringValue(value.type);
  if (type === "auto" || type === "none" || type === "any") return [];
  if (isRecord(value.function)) {
    if (type && type !== "function") {
      throw new Error(`Coverage suite task ${taskId} tool_choice function must use type function.`);
    }
    const functionName = stringValue(value.function.name);
    if (functionName && TOOL_NAME_PATTERN.test(functionName)) return [functionName];
    throw new Error(`Coverage suite task ${taskId} tool_choice has an invalid tool name.`);
  }
  const name = stringValue(value.name);
  if (name && TOOL_NAME_PATTERN.test(name)) return [name];
  throw new Error(`Coverage suite task ${taskId} tool_choice has an invalid or missing tool name.`);
}

function validateJsonSchema(label: string, schema: unknown): Record<string, unknown> {
  if (schema === undefined) throw new Error(`${label} schema is required.`);
  if (!isRecord(schema)) throw new Error(`${label} must be a JSON schema object.`);
  if (schema.type !== "object") throw new Error(`${label} must be an object JSON schema.`);
  if (!isRecord(schema.properties)) throw new Error(`${label} must declare object properties.`);
  if ("required" in schema && !Array.isArray(schema.required)) {
    throw new Error(`${label} required must be an array.`);
  }
  compileJsonSchema(label, schema);
  return schema;
}

function validateCoverageSuiteToolArgumentSurface(label: string, schema: Record<string, unknown>): void {
  // Coverage-suite scoped: this suite's tool task exists to exercise tool-argument
  // validity, so a zero-argument or semantically empty tool schema does not open
  // the measured surface. This is not a general provider API rule; no-argument
  // tools can be legitimate outside the coverage-suite manifest context.
  if (hasUsableCoverageSuiteToolArgument(schema)) return;
  throw new Error(`${label} schema must declare at least one usable coverage-suite tool argument property.`);
}

function hasUsableCoverageSuiteToolArgument(schema: Record<string, unknown>): boolean {
  const properties = schema.properties;
  if (!isRecord(properties)) return false;
  return Object.values(properties).some(isUsableCoverageSuiteToolProperty);
}

function isUsableCoverageSuiteToolProperty(property: unknown): boolean {
  if (!isRecord(property)) return false;
  const type = property.type;
  if (typeof type === "string") return isUsableCoverageSuiteToolType(property, type);
  if (Array.isArray(type)) {
    return type.some((entry) =>
      typeof entry === "string" && isUsableCoverageSuiteToolType(property, entry)
    );
  }
  return false;
}

function isUsableCoverageSuiteToolType(property: Record<string, unknown>, type: string): boolean {
  if (type === "object") return hasUsableCoverageSuiteToolArgument(property);
  if (type === "array") return isUsableCoverageSuiteToolProperty(property.items);
  return type !== "null";
}

function compileJsonSchema(label: string, schema: Record<string, unknown>): void {
  try {
    JSON_SCHEMA_VALIDATOR.compile(schema);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} schema failed to compile: ${message}`, {
      cause: error,
    });
  }
}

function walkRecords(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(walkRecords);
  if (!isRecord(value)) return [];
  return [value, ...Object.values(value).flatMap(walkRecords)];
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Coverage suite ${label} must be unique.`);
    seen.add(value);
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  const parsed = stringValue(value);
  if (!parsed) throw new Error(`${label} is required.`);
  return parsed;
}

function requiredStringOrNumber(value: unknown, label: string): string | number {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`${label} is required.`);
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => !stringValue(entry))) {
    throw new Error(`${label} must be a string array.`);
  }
  return value.map((entry) => String(entry));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerValue(value: unknown, label: string): number;
function integerValue(value: unknown, label: string, optional: true): number | undefined;
function integerValue(value: unknown, label: string, optional = false): number | undefined {
  if (value === undefined && optional) return undefined;
  if (!Number.isInteger(value)) throw new Error(`Coverage suite ${label} must be an integer.`);
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
