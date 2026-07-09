import { readFile } from "node:fs/promises";
import { stableSha256 } from "../coverage-suite/canonical-json.js";
export const DRIFT_CANARY_WORKLOAD_CLASS = "drift_canary";
export const DRIFT_CANARY_SUITE_TASK_PREFIX = "drift_canary:";
export const DRIFT_CANARY_ITEM_COUNT = 50;
export const DRIFT_CANARY_BASELINE_RUN_COUNT = 3;
export const DRIFT_CANARY_PROMPT_SET_VERSION = "drift-canary-prompt-set-v1";
export const DRIFT_CANARY_MAX_COMPLETION_TOKENS_LOWER_BOUND = 256;
export const DRIFT_CANARY_ESTIMATED_USAGE = {
    input: 220,
    output: 32,
};
export const driftCanaryManifestUrl = new URL("./inferock-drift-canary-v1.json", import.meta.url);
export const CHECKED_IN_DRIFT_CANARY_V1_MANIFEST_HASH = "sha256:62e008249abeca30c0a319e0da19b3e194394cdbf074f5cdd99c778c0b1f72cb";
export async function loadDriftCanaryManifest(path = driftCanaryManifestUrl) {
    const raw = await readFile(path, "utf8");
    const manifest = loadDriftCanaryManifestFromValue(JSON.parse(raw));
    if (manifest.manifestHash !== CHECKED_IN_DRIFT_CANARY_V1_MANIFEST_HASH) {
        throw new Error("Drift canary v1 manifest is hash-pinned; update the checked-in hash with the manifest.");
    }
    return manifest;
}
export function loadDriftCanaryManifestFromValue(value) {
    const manifest = parseDriftCanaryManifest(value);
    validateDriftCanaryManifest(manifest);
    return {
        ...manifest,
        manifestHash: computeDriftCanaryManifestHash(manifest),
    };
}
export function computeDriftCanaryManifestHash(value) {
    return stableSha256(value);
}
export function driftCanarySuiteTaskId(itemId) {
    return `${DRIFT_CANARY_SUITE_TASK_PREFIX}${itemId}`;
}
export function driftCanaryItemIdFromSuiteTaskId(suiteTaskId) {
    if (!suiteTaskId?.startsWith(DRIFT_CANARY_SUITE_TASK_PREFIX))
        return null;
    return suiteTaskId.slice(DRIFT_CANARY_SUITE_TASK_PREFIX.length);
}
export function driftCanaryEffectiveProtocol(manifest, input) {
    const openAiReasoning = input.provider === "openai" && isOpenAiReasoningChatModel(input.model);
    const anthropicProviderDefault = input.provider === "anthropic" &&
        isAnthropicTemperatureUnsupportedModel(input.model);
    const openRouterProviderDefault = input.provider === "openrouter" &&
        isOpenRouterTemperatureUnsupportedModel(input.model);
    const temperatureMode = openAiReasoning || anthropicProviderDefault || openRouterProviderDefault
        ? "provider_default"
        : "fixed_0";
    const maxTokenParameter = openAiReasoning ? "max_completion_tokens" : "max_tokens";
    const maxTokenBound = openAiReasoning
        ? Math.max(manifest.protocol.maxTokens, manifest.protocol.maxCompletionTokensLowerBound)
        : manifest.protocol.maxTokens;
    const requestRoute = input.provider === "anthropic"
        ? "anthropic.messages"
        : input.provider === "gemini"
            ? "gemini.generateContent"
            : manifest.protocol.route;
    const versionPayload = {
        schemaVersion: "inferock-drift-canary-effective-protocol-v1",
        methodVersion: manifest.methodVersion,
        promptSetVersion: manifest.protocol.promptSetVersion,
        requestRoute,
        temperatureMode,
        maxTokenParameter,
        maxTokenBound,
        systemPrompt: manifest.protocol.systemPrompt,
        grading: manifest.protocol.grading,
        flagging: manifest.protocol.flagging,
    };
    return {
        protocolVersion: stableSha256(versionPayload),
        promptSetVersion: manifest.protocol.promptSetVersion,
        temperatureMode,
        maxTokenParameter,
        maxTokenBound,
        requestRoute,
    };
}
export function isAnthropicTemperatureUnsupportedModel(model) {
    if (!model)
        return false;
    return /^claude-[a-z]+-5(?:-|$)/.test(model) ||
        /^claude-[a-z]+-4-(?:[7-9]|\d{2,})(?:-|$)/.test(model);
}
export function isOpenAiReasoningChatModel(model) {
    return model.startsWith("gpt-5") || model.startsWith("o");
}
export function isOpenRouterTemperatureUnsupportedModel(model) {
    return model === "moonshotai/kimi-k2.7-code";
}
function parseDriftCanaryManifest(value) {
    if (!isRecord(value))
        throw new Error("Drift canary manifest must be an object.");
    if (value.schemaVersion !== "inferock-drift-canary-manifest-v1") {
        throw new Error("Drift canary manifest schemaVersion is invalid.");
    }
    if (value.suiteVersion !== "inferock-drift-canary-v1") {
        throw new Error("Drift canary manifest suiteVersion is invalid.");
    }
    if (value.methodVersion !== "drift-canary-method-v1-2026-07-04") {
        throw new Error("Drift canary manifest methodVersion is invalid.");
    }
    if (!isRecord(value.protocol))
        throw new Error("Drift canary protocol is required.");
    if (!isRecord(value.provenance))
        throw new Error("Drift canary provenance is required.");
    if (!Array.isArray(value.citations))
        throw new Error("Drift canary citations must be an array.");
    if (!Array.isArray(value.items))
        throw new Error("Drift canary items must be an array.");
    return {
        schemaVersion: value.schemaVersion,
        suiteVersion: value.suiteVersion,
        methodVersion: value.methodVersion,
        baselineRunCount: integerValue(value.baselineRunCount, "baselineRunCount"),
        alpha: numberValue(value.alpha, "alpha"),
        protocol: parseProtocol(value.protocol),
        provenance: parseProvenance(value.provenance),
        citations: stringArray(value.citations, "citations"),
        items: value.items.map(parseItem),
    };
}
function parseProtocol(value) {
    if (value.promptSetVersion !== DRIFT_CANARY_PROMPT_SET_VERSION) {
        throw new Error(`Drift canary promptSetVersion must be ${DRIFT_CANARY_PROMPT_SET_VERSION}.`);
    }
    if (value.temperature !== 0)
        throw new Error("Drift canary protocol temperature must be 0.");
    if (value.temperatureMode !== "fixed_0_unless_provider_rejects") {
        throw new Error("Drift canary temperatureMode must be fixed_0_unless_provider_rejects.");
    }
    if (!Array.isArray(value.providerDefaultTemperatureModels)) {
        throw new Error("Drift canary providerDefaultTemperatureModels must be an array.");
    }
    if (value.maxCompletionTokensLowerBound !== DRIFT_CANARY_MAX_COMPLETION_TOKENS_LOWER_BOUND) {
        throw new Error(`Drift canary maxCompletionTokensLowerBound must be ${DRIFT_CANARY_MAX_COMPLETION_TOKENS_LOWER_BOUND}.`);
    }
    if (value.route !== "chat.completions")
        throw new Error("Drift canary route must be chat.completions.");
    return {
        promptSetVersion: DRIFT_CANARY_PROMPT_SET_VERSION,
        temperature: 0,
        temperatureMode: "fixed_0_unless_provider_rejects",
        providerDefaultTemperatureModels: stringArray(value.providerDefaultTemperatureModels, "protocol.providerDefaultTemperatureModels"),
        maxTokens: integerValue(value.maxTokens, "protocol.maxTokens"),
        maxCompletionTokensLowerBound: DRIFT_CANARY_MAX_COMPLETION_TOKENS_LOWER_BOUND,
        route: "chat.completions",
        systemPrompt: requiredString(value.systemPrompt, "protocol.systemPrompt"),
        grading: requiredString(value.grading, "protocol.grading"),
        flagging: requiredString(value.flagging, "protocol.flagging"),
    };
}
function parseProvenance(value) {
    return {
        gsm8kPlatinum: parseSourceProvenance(value.gsm8kPlatinum, "gsm8kPlatinum"),
        mmlu: parseSourceProvenance(value.mmlu, "mmlu"),
        simpleEvals: parseSimpleEvalsProvenance(value.simpleEvals),
        excludedCode: parseExcludedCode(value.excludedCode),
    };
}
function parseSourceProvenance(value, label) {
    if (!isRecord(value))
        throw new Error(`Drift canary ${label} provenance is required.`);
    if (value.license !== "MIT")
        throw new Error(`Drift canary ${label} provenance must be MIT.`);
    return {
        sourceUrl: requiredString(value.sourceUrl, `${label}.sourceUrl`),
        sourceDataUrl: requiredString(value.sourceDataUrl, `${label}.sourceDataUrl`),
        ...(stringValue(value.sourceRevision) ? { sourceRevision: stringValue(value.sourceRevision) } : {}),
        license: "MIT",
        selection: requiredString(value.selection, `${label}.selection`),
    };
}
function parseSimpleEvalsProvenance(value) {
    if (!isRecord(value))
        throw new Error("Drift canary simple-evals provenance is required.");
    if (value.license !== "MIT")
        throw new Error("Drift canary simple-evals provenance must be MIT.");
    return {
        sourceUrl: requiredString(value.sourceUrl, "simpleEvals.sourceUrl"),
        license: "MIT",
        use: requiredString(value.use, "simpleEvals.use"),
    };
}
function parseExcludedCode(value) {
    if (!isRecord(value))
        throw new Error("Drift canary excludedCode provenance is required.");
    return {
        source: requiredString(value.source, "excludedCode.source"),
        reason: requiredString(value.reason, "excludedCode.reason"),
    };
}
function parseItem(value, index) {
    if (!isRecord(value))
        throw new Error(`Drift canary item ${index} must be an object.`);
    const dataset = value.dataset;
    const base = {
        itemId: requiredString(value.itemId, `item ${index}.itemId`),
        sourceRow: integerValue(value.sourceRow, `item ${index}.sourceRow`),
        sourceSplit: requiredString(value.sourceSplit, `item ${index}.sourceSplit`),
        question: requiredString(value.question, `item ${index}.question`),
        expectedAnswer: requiredString(value.expectedAnswer, `item ${index}.expectedAnswer`),
    };
    if (dataset === "gsm8k_platinum") {
        return {
            ...base,
            dataset,
            sourceConfig: "main",
            cleaningStatus: requiredString(value.cleaningStatus, `item ${index}.cleaningStatus`),
        };
    }
    if (dataset === "mmlu_hendrycks_test") {
        if (!isRecord(value.choices))
            throw new Error(`Drift canary item ${index} choices are required.`);
        return {
            ...base,
            dataset,
            subject: requiredString(value.subject, `item ${index}.subject`),
            choices: {
                A: requiredString(value.choices.A, `item ${index}.choices.A`),
                B: requiredString(value.choices.B, `item ${index}.choices.B`),
                C: requiredString(value.choices.C, `item ${index}.choices.C`),
                D: requiredString(value.choices.D, `item ${index}.choices.D`),
            },
        };
    }
    throw new Error(`Drift canary item ${index} dataset is invalid.`);
}
function validateDriftCanaryManifest(manifest) {
    if (manifest.baselineRunCount !== DRIFT_CANARY_BASELINE_RUN_COUNT) {
        throw new Error(`Drift canary baselineRunCount must be ${DRIFT_CANARY_BASELINE_RUN_COUNT}.`);
    }
    if (manifest.alpha !== 0.05)
        throw new Error("Drift canary alpha must be 0.05.");
    if (manifest.protocol.maxTokens < 16)
        throw new Error("Drift canary maxTokens is too small.");
    const gsmCount = manifest.items.filter((item) => item.dataset === "gsm8k_platinum").length;
    const mmluCount = manifest.items.filter((item) => item.dataset === "mmlu_hendrycks_test").length;
    if (gsmCount !== 25 || mmluCount !== 25 || manifest.items.length !== DRIFT_CANARY_ITEM_COUNT) {
        throw new Error("Drift canary v1 must contain exactly 25 GSM8K-Platinum and 25 MMLU items.");
    }
    const ids = new Set();
    for (const item of manifest.items) {
        if (ids.has(item.itemId))
            throw new Error(`Duplicate drift canary itemId ${item.itemId}.`);
        ids.add(item.itemId);
        if (item.dataset === "gsm8k_platinum" && !/^-?(?:\d+|\d*\.\d+)$/.test(item.expectedAnswer)) {
            throw new Error(`GSM8K-Platinum item ${item.itemId} expectedAnswer must be numeric.`);
        }
        if (item.dataset === "mmlu_hendrycks_test" && !/^[ABCD]$/.test(item.expectedAnswer)) {
            throw new Error(`MMLU item ${item.itemId} expectedAnswer must be A/B/C/D.`);
        }
    }
}
function requiredString(value, label) {
    const string = stringValue(value);
    if (!string)
        throw new Error(`Drift canary ${label} is required.`);
    return string;
}
function stringArray(value, label) {
    if (!Array.isArray(value))
        throw new Error(`Drift canary ${label} must be an array.`);
    return value.map((entry, index) => requiredString(entry, `${label}.${index}`));
}
function integerValue(value, label) {
    if (!Number.isInteger(value) || Number(value) < 0) {
        throw new Error(`Drift canary ${label} must be a non-negative integer.`);
    }
    return Number(value);
}
function numberValue(value, label) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Drift canary ${label} must be a finite number.`);
    }
    return value;
}
function stringValue(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
//# sourceMappingURL=manifest.js.map