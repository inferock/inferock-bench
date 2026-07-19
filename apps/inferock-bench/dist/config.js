import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ensurePrivateDir, writePrivateTextFile } from "./private-files.js";
import { isRecord, stringValue } from "./record.js";
export const DEFAULT_PORT = 4318;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const WATERMARK_NAME = "Inferock Bench";
const WATERMARK_HOST = ["inferock", "opiusai", "com"].join(".");
export const WATERMARK_URL = `https://${WATERMARK_HOST}`;
export function resolveBenchPaths(env = process.env) {
    const homeDir = env.INFEROCK_BENCH_HOME ?? join(homedir(), ".inferock-bench");
    return {
        homeDir,
        configFile: join(homeDir, "config"),
        legacyConfigFile: join(homeDir, "config.json"),
        eventsFile: join(homeDir, "events.jsonl"),
        receiptsDir: join(homeDir, "receipts"),
    };
}
export async function ensureBenchHome(paths) {
    await ensurePrivateDir(paths.homeDir);
}
export async function readBenchConfig(paths) {
    try {
        const raw = await readFile(paths.configFile, "utf8");
        return parseBenchConfig(JSON.parse(raw));
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
            return readLegacyBenchConfig(paths);
        }
        throw error;
    }
}
export async function writeBenchConfig(paths, config) {
    await ensureBenchHome(paths);
    await writePrivateTextFile(paths.configFile, `${JSON.stringify(config, null, 2)}\n`);
}
export function benchKeyFromConfig(config, env = process.env) {
    return env.INFEROCK_BENCH_KEY ?? config.benchKey ?? "";
}
export function acceptedBenchKeysFromConfig(config, env = process.env) {
    return uniqueStrings([
        config.benchKey,
        env.INFEROCK_BENCH_KEY,
    ]);
}
export function generateBenchKey() {
    return `ibl_${randomBytes(12).toString("hex")}`;
}
export async function ensureGeneratedBenchKey(input) {
    if (input.config.benchKey)
        return input.config;
    const config = {
        ...input.config,
        benchKey: generateBenchKey(),
    };
    await writeBenchConfig(input.paths, config);
    return config;
}
export async function applyProviderKeyUpdate(input) {
    const config = { ...input.config };
    if ("openaiApiKey" in input.update) {
        const next = normalizedKeyUpdate(input.update.openaiApiKey);
        if (next)
            config.openaiApiKey = next;
        else
            delete config.openaiApiKey;
    }
    if ("anthropicApiKey" in input.update) {
        const next = normalizedKeyUpdate(input.update.anthropicApiKey);
        if (next)
            config.anthropicApiKey = next;
        else
            delete config.anthropicApiKey;
    }
    if ("geminiApiKey" in input.update) {
        const next = normalizedKeyUpdate(input.update.geminiApiKey);
        if (next)
            config.geminiApiKey = next;
        else
            delete config.geminiApiKey;
    }
    if ("openrouterApiKey" in input.update) {
        const next = normalizedKeyUpdate(input.update.openrouterApiKey);
        if (next)
            config.openrouterApiKey = next;
        else
            delete config.openrouterApiKey;
    }
    await writeBenchConfig(input.paths, config);
    return config;
}
export function providerApiKey(provider, config, env = process.env) {
    if (provider === "openai") {
        return env.INFEROCK_BENCH_OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? config.openaiApiKey;
    }
    if (provider === "anthropic") {
        return env.INFEROCK_BENCH_ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY ?? config.anthropicApiKey;
    }
    if (provider === "gemini") {
        return env.INFEROCK_BENCH_GEMINI_API_KEY ??
            env.GEMINI_API_KEY ??
            env.GOOGLE_API_KEY ??
            config.geminiApiKey;
    }
    return env.INFEROCK_BENCH_OPENROUTER_API_KEY ?? env.OPENROUTER_API_KEY ?? config.openrouterApiKey;
}
export function providerKeyStatus(provider, config, env = process.env) {
    const envKey = provider === "openai"
        ? env.INFEROCK_BENCH_OPENAI_API_KEY ?? env.OPENAI_API_KEY
        : provider === "anthropic"
            ? env.INFEROCK_BENCH_ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY
            : provider === "gemini"
                ? env.INFEROCK_BENCH_GEMINI_API_KEY ?? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY
                : env.INFEROCK_BENCH_OPENROUTER_API_KEY ?? env.OPENROUTER_API_KEY;
    if (envKey) {
        return {
            configured: true,
            source: "env",
            maskedKey: maskSecret(envKey),
        };
    }
    const configKey = provider === "openai"
        ? config.openaiApiKey
        : provider === "anthropic"
            ? config.anthropicApiKey
            : provider === "gemini"
                ? config.geminiApiKey
                : config.openrouterApiKey;
    if (configKey) {
        return {
            configured: true,
            source: "config",
            maskedKey: maskSecret(configKey),
        };
    }
    return {
        configured: false,
        source: null,
        maskedKey: null,
    };
}
export function maskSecret(secret) {
    const trimmed = secret.trim();
    const prefix = safeSecretClassPrefix(trimmed);
    if (trimmed.length === 0)
        return "***";
    if (trimmed.length < 12)
        return prefix ? `${prefix}***` : "***";
    return `${prefix}...${trimmed.slice(-4)}`;
}
export function providerBaseUrl(provider, _config, env = process.env) {
    const endpoint = provider === "openai"
        ? env.INFEROCK_BENCH_OPENAI_BASE_URL
        : provider === "anthropic"
            ? env.INFEROCK_BENCH_ANTHROPIC_BASE_URL
            : provider === "gemini"
                ? env.INFEROCK_BENCH_GEMINI_BASE_URL
                : env.INFEROCK_BENCH_OPENROUTER_BASE_URL;
    if (endpoint)
        return endpoint;
    if (provider === "openai")
        return DEFAULT_OPENAI_BASE_URL;
    if (provider === "anthropic")
        return DEFAULT_ANTHROPIC_BASE_URL;
    if (provider === "gemini")
        return DEFAULT_GEMINI_BASE_URL;
    return DEFAULT_OPENROUTER_BASE_URL;
}
export function reliabilityEndpoint(config, env = process.env) {
    return env.INFEROCK_BENCH_INDEX_ENDPOINT ?? config.reliabilityIndex?.endpoint;
}
export async function ensureReliabilityIndexAsked(inputConfig) {
    const env = inputConfig.env ?? process.env;
    const log = inputConfig.log ?? console.log;
    if (inputConfig.config.reliabilityIndex?.askedAt)
        return inputConfig.config;
    const askedAt = new Date().toISOString();
    const tty = inputConfig.stdinIsTty ?? Boolean(input.isTTY);
    const outTty = inputConfig.stdoutIsTty ?? Boolean(output.isTTY);
    let enabled = false;
    if (env.INFEROCK_BENCH_RELIABILITY_INDEX === "on") {
        enabled = true;
    }
    else if (tty && outTty) {
        enabled = await askReliabilityOptIn();
    }
    else {
        log("Reliability index opt-in defaulted to off. Run `inferock-bench telemetry enable --reliability-index` to opt in.");
    }
    const config = {
        ...inputConfig.config,
        reliabilityIndex: {
            ...(inputConfig.config.reliabilityIndex ?? {}),
            askedAt,
            enabled,
        },
    };
    await writeBenchConfig(inputConfig.paths, config);
    return config;
}
export async function setReliabilityIndexEnabled(input) {
    const config = {
        ...input.config,
        reliabilityIndex: {
            ...(input.config.reliabilityIndex ?? {}),
            askedAt: input.config.reliabilityIndex?.askedAt ?? new Date().toISOString(),
            enabled: input.enabled,
        },
    };
    await writeBenchConfig(input.paths, config);
    return config;
}
function parseBenchConfig(value) {
    if (!isRecord(value))
        return {};
    const reliability = parseReliabilityIndexConfig(value.reliabilityIndex);
    const coverageTest = parseCoverageTestConfig(value.coverageTest);
    return {
        ...(stringValue(value.benchKey) ? { benchKey: stringValue(value.benchKey) } : {}),
        ...(stringValue(value.openaiApiKey) ? { openaiApiKey: stringValue(value.openaiApiKey) } : {}),
        ...(stringValue(value.anthropicApiKey) ? { anthropicApiKey: stringValue(value.anthropicApiKey) } : {}),
        ...(stringValue(value.geminiApiKey) ? { geminiApiKey: stringValue(value.geminiApiKey) } : {}),
        ...(stringValue(value.openrouterApiKey) ? { openrouterApiKey: stringValue(value.openrouterApiKey) } : {}),
        ...(reliability ? { reliabilityIndex: reliability } : {}),
        ...(coverageTest ? { coverageTest } : {}),
    };
}
async function readLegacyBenchConfig(paths) {
    try {
        const raw = await readFile(paths.legacyConfigFile, "utf8");
        const config = parseBenchConfig(JSON.parse(raw));
        await writeBenchConfig(paths, config);
        return config;
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return {};
        throw error;
    }
}
function normalizedKeyUpdate(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function safeSecretClassPrefix(secret) {
    if (secret.startsWith("ibl_") && secret.length > "ibl_".length)
        return "ibl_";
    if (secret.startsWith("sk-or-") && secret.length > "sk-or-".length)
        return "sk-or-";
    if (secret.startsWith("sk-") && secret.length > "sk-".length)
        return "sk-";
    return "";
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => Boolean(value)))];
}
function parseReliabilityIndexConfig(value) {
    if (!isRecord(value))
        return undefined;
    return {
        enabled: value.enabled === true,
        ...(stringValue(value.askedAt) ? { askedAt: stringValue(value.askedAt) } : {}),
        ...(stringValue(value.endpoint) ? { endpoint: stringValue(value.endpoint) } : {}),
    };
}
function parseCoverageTestConfig(value) {
    if (!isRecord(value))
        return undefined;
    const defaultPreset = value.defaultPreset === "cheap" || value.defaultPreset === "standard"
        ? value.defaultPreset
        : undefined;
    const defaultGenerator = value.defaultGenerator === "built-in" || value.defaultGenerator === "agent"
        ? value.defaultGenerator
        : undefined;
    const spendCapMultiplierOverride = typeof value.spendCapMultiplierOverride === "number" &&
        Number.isFinite(value.spendCapMultiplierOverride) &&
        value.spendCapMultiplierOverride > 1
        ? value.spendCapMultiplierOverride
        : undefined;
    const driftReplayContract = parseDriftReplayContractConfig(value.driftReplayContract ?? value.driftContract);
    const config = {
        ...(defaultPreset ? { defaultPreset } : {}),
        ...(defaultGenerator ? { defaultGenerator } : {}),
        ...(spendCapMultiplierOverride ? { spendCapMultiplierOverride } : {}),
        ...(stringValue(value.agentCommand) ? { agentCommand: stringValue(value.agentCommand) } : {}),
        ...(stringValue(value.chargeObservationFile)
            ? { chargeObservationFile: stringValue(value.chargeObservationFile) }
            : {}),
        ...(driftReplayContract ? { driftReplayContract } : {}),
    };
    return Object.keys(config).length > 0 ? config : undefined;
}
function parseDriftReplayContractConfig(value) {
    if (!isRecord(value))
        return undefined;
    const contractId = stringValue(value.contractId);
    const repeatGroupId = stringValue(value.repeatGroupId);
    const matcher = value.matcher;
    const threshold = typeof value.threshold === "number" && Number.isFinite(value.threshold) && value.threshold >= 0
        ? value.threshold
        : undefined;
    if (!contractId ||
        !repeatGroupId ||
        threshold === undefined ||
        (matcher !== "exact" && matcher !== "semantic" && matcher !== "known_answer")) {
        return undefined;
    }
    return {
        contractId,
        matcher,
        repeatGroupId,
        threshold,
    };
}
async function askReliabilityOptIn() {
    const rl = createInterface({ input, output });
    try {
        const answer = await rl.question("Join the public reliability index? Aggregates only: no prompts, outputs, keys, traces, or identifiers. Type yes to opt in [default no]: ");
        return answer.trim().toLowerCase() === "yes";
    }
    finally {
        rl.close();
    }
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
//# sourceMappingURL=config.js.map