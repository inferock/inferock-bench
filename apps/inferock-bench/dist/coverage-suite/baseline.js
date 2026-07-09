import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { loadCoverageSuiteManifest, } from "./manifest.js";
import { stableSha256 } from "./canonical-json.js";
import { BENCH_PACKAGE_VERSION } from "../version.js";
const execFileAsync = promisify(execFile);
export const coverageTokenBaselineUrl = new URL("./baselines/coverage-suite-v1.tokens.json", import.meta.url);
export async function loadCoverageTokenBaseline(path = coverageTokenBaselineUrl, suite) {
    const resolvedSuite = suite ?? await loadCoverageSuiteManifest();
    const raw = await readFile(path, "utf8");
    return loadCoverageTokenBaselineFromValue(JSON.parse(raw), resolvedSuite);
}
export function loadCoverageTokenBaselineFromValue(value, suite) {
    const baseline = parseCoverageTokenBaseline(value);
    validateCoverageTokenBaseline(baseline, suite);
    return {
        ...baseline,
        baselineVersion: coverageBaselineVersion(baseline),
        baselineContentDigest: coverageBaselineContentDigest(baseline),
    };
}
export function coverageBaselineVersion(baseline) {
    return stableSha256({
        schemaVersion: baseline.schemaVersion,
        suiteVersion: baseline.suiteVersion,
        suiteManifestHash: baseline.suiteManifestHash,
        generatedAt: baseline.generatedAt,
        quantile: baseline.quantile,
    });
}
export function coverageBaselineContentDigest(baseline) {
    return stableSha256({
        suiteManifestHash: baseline.suiteManifestHash,
        quantile: baseline.quantile,
        tasks: baseline.tasks
            .map((task) => ({
            taskId: task.taskId,
            plannedCalls: task.plannedCalls,
            usage: {
                input: task.usage.input,
                output: task.usage.output,
                cacheRead: task.usage.cacheRead ?? 0,
                cacheCreation: task.usage.cacheCreation ?? 0,
                categories: [...(task.usage.categories ?? [])]
                    .map((category) => ({
                    category: category.category,
                    tokens: category.tokens,
                    sourceField: category.sourceField ?? null,
                    provider: category.provider ?? null,
                }))
                    .sort((left, right) => [
                    left.category,
                    left.sourceField ?? "",
                    left.provider ?? "",
                ].join("\u001f").localeCompare([
                    right.category,
                    right.sourceField ?? "",
                    right.provider ?? "",
                ].join("\u001f"))),
            },
        }))
            .sort((left, right) => left.taskId.localeCompare(right.taskId)),
    });
}
export function normalizedUsageFromBaselineTask(task) {
    return {
        input: task.usage.input,
        output: task.usage.output,
        ...(task.usage.cacheRead !== undefined || task.usage.cacheCreation !== undefined
            ? {
                cache: {
                    ...(task.usage.cacheRead !== undefined ? { read: task.usage.cacheRead } : {}),
                    ...(task.usage.cacheCreation !== undefined ? { creation: task.usage.cacheCreation } : {}),
                },
            }
            : {}),
        ...(task.usage.categories ? { categories: task.usage.categories } : {}),
    };
}
export async function deriveCoverageTokenBaselineFromCovrun(input) {
    const [report, preconditions] = await Promise.all([
        readFile(input.reportPath, "utf8"),
        readFile(input.preconditionsPath, "utf8"),
    ]);
    const sourceCommit = input.sourceCommit ?? await resolveCoverageBaselineSourceCommit(input.repoCwd);
    const baseline = {
        schemaVersion: "inferock-coverage-token-baseline-v1",
        suiteVersion: input.suite.suiteVersion,
        suiteManifestHash: input.suite.manifestHash,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        generatedBy: "covrun",
        provenance: {
            sourcePath: input.sourcePath,
            sourceCommit,
            benchPackageVersion: input.benchPackageVersion ?? BENCH_PACKAGE_VERSION,
            providerModelsMeasured: providerModelsMeasured(report),
            sampleCountByTask: Object.fromEntries(input.suite.tasks.map((task) => [task.taskId, 0])),
            notes: [
                "Derived from covrun report and precondition documents.",
                "The supplied artifacts document aggregate measured traffic and carried preconditions, but not per-task token usage.",
                "Every task is therefore marked bootstrap_required and must fail the loader until a real per-task measured harvest exists.",
                preconditions.includes("Code-derived Measure Preconditions")
                    ? "Precondition document confirmed code-derived measurement basis."
                    : "Precondition document was supplied but did not include the expected heading.",
            ].join(" "),
        },
        quantile: "reviewed",
        tasks: input.suite.tasks.map(placeholderTask),
    };
    if (input.outputPath) {
        await writeFile(input.outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    }
    return baseline;
}
function placeholderTask(task) {
    return {
        taskId: task.taskId,
        plannedCalls: 0,
        provenance: "bootstrap_required",
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheCreation: 0,
        },
    };
}
function parseCoverageTokenBaseline(value) {
    if (!isRecord(value))
        throw new Error("Coverage token baseline must be an object.");
    if (value.schemaVersion !== "inferock-coverage-token-baseline-v1") {
        throw new Error("Coverage token baseline schemaVersion is invalid.");
    }
    if (value.generatedBy !== "covrun") {
        throw new Error("Coverage token baseline generatedBy must be covrun.");
    }
    if (!["p95", "max", "reviewed"].includes(String(value.quantile))) {
        throw new Error("Coverage token baseline quantile is invalid.");
    }
    if (!Array.isArray(value.tasks))
        throw new Error("Coverage token baseline tasks must be an array.");
    return {
        schemaVersion: value.schemaVersion,
        suiteVersion: requiredString(value.suiteVersion, "suiteVersion"),
        suiteManifestHash: requiredString(value.suiteManifestHash, "suiteManifestHash"),
        generatedAt: requiredString(value.generatedAt, "generatedAt"),
        generatedBy: value.generatedBy,
        provenance: parseBaselineProvenance(value.provenance),
        quantile: value.quantile,
        tasks: value.tasks.map(parseBaselineTask),
    };
}
function parseBaselineProvenance(value) {
    if (!isRecord(value))
        throw new Error("Coverage token baseline provenance is required.");
    if (!isRecord(value.sampleCountByTask)) {
        throw new Error("Coverage token baseline provenance sampleCountByTask is required.");
    }
    return {
        sourcePath: requiredString(value.sourcePath, "provenance.sourcePath"),
        sourceCommit: requiredString(value.sourceCommit, "provenance.sourceCommit"),
        benchPackageVersion: requiredString(value.benchPackageVersion, "provenance.benchPackageVersion"),
        providerModelsMeasured: stringArray(value.providerModelsMeasured, "provenance.providerModelsMeasured"),
        sampleCountByTask: Object.fromEntries(Object.entries(value.sampleCountByTask).map(([taskId, count]) => {
            if (!Number.isInteger(count) || Number(count) < 0) {
                throw new Error(`Coverage token baseline sample count for ${taskId} is invalid.`);
            }
            return [taskId, Number(count)];
        })),
        notes: requiredString(value.notes, "provenance.notes"),
    };
}
function parseBaselineTask(value, index) {
    if (!isRecord(value))
        throw new Error(`Coverage token baseline task ${index} must be an object.`);
    if (!isRecord(value.usage))
        throw new Error(`Coverage token baseline task ${index} usage is required.`);
    const provenance = stringValue(value.provenance);
    if (provenance !== undefined && provenance !== "covrun_measured" && provenance !== "bootstrap_required") {
        throw new Error(`Coverage token baseline task ${index} provenance is invalid.`);
    }
    return {
        taskId: requiredString(value.taskId, `task ${index} taskId`),
        plannedCalls: integerValue(value.plannedCalls, `task ${index} plannedCalls`),
        ...(provenance ? { provenance } : {}),
        usage: {
            input: integerValue(value.usage.input, `task ${index} usage.input`),
            output: integerValue(value.usage.output, `task ${index} usage.output`),
            ...(value.usage.cacheRead !== undefined
                ? { cacheRead: integerValue(value.usage.cacheRead, `task ${index} usage.cacheRead`) }
                : {}),
            ...(value.usage.cacheCreation !== undefined
                ? { cacheCreation: integerValue(value.usage.cacheCreation, `task ${index} usage.cacheCreation`) }
                : {}),
            ...(Array.isArray(value.usage.categories)
                ? { categories: value.usage.categories.map(parseBaselineCategory) }
                : {}),
        },
    };
}
function parseBaselineCategory(value, index) {
    if (!isRecord(value))
        throw new Error(`Coverage token baseline usage category ${index} must be an object.`);
    return {
        category: requiredString(value.category, `usage category ${index} category`),
        tokens: integerValue(value.tokens, `usage category ${index} tokens`),
        ...(stringValue(value.sourceField) ? { sourceField: stringValue(value.sourceField) } : {}),
        ...(value.provider === "openai" ||
            value.provider === "anthropic" ||
            value.provider === "gemini" ||
            value.provider === "openrouter"
            ? { provider: value.provider }
            : {}),
    };
}
function validateCoverageTokenBaseline(baseline, suite) {
    if (baseline.suiteVersion !== suite.suiteVersion) {
        throw new Error("Coverage token baseline suiteVersion does not match the suite manifest.");
    }
    if (baseline.suiteManifestHash !== suite.manifestHash) {
        throw new Error("Coverage token baseline suite manifest hash is stale.");
    }
    if (Number.isNaN(new Date(baseline.generatedAt).getTime())) {
        throw new Error("Coverage token baseline generatedAt must be an ISO timestamp.");
    }
    assertTaskCoverage(baseline, suite);
    for (const task of baseline.tasks) {
        if (task.provenance === "bootstrap_required") {
            throw new Error(`Coverage token baseline task ${task.taskId} is bootstrap_required.`);
        }
        if (task.plannedCalls <= 0) {
            throw new Error(`Coverage token baseline task ${task.taskId} plannedCalls must be positive.`);
        }
        const sampleCount = baseline.provenance.sampleCountByTask[task.taskId] ?? 0;
        if (sampleCount <= 0) {
            throw new Error(`Coverage token baseline task ${task.taskId} has no measured samples.`);
        }
        const usageTotal = task.usage.input +
            task.usage.output +
            (task.usage.cacheRead ?? 0) +
            (task.usage.cacheCreation ?? 0) +
            (task.usage.categories?.reduce((total, category) => total + category.tokens, 0) ?? 0);
        if (usageTotal <= 0) {
            throw new Error(`Coverage token baseline task ${task.taskId} has zero token usage.`);
        }
    }
}
function assertTaskCoverage(baseline, suite) {
    const expected = suite.tasks.map((task) => task.taskId);
    const actual = baseline.tasks.map((task) => task.taskId);
    const actualSet = new Set(actual);
    for (const taskId of expected) {
        if (!actualSet.has(taskId))
            throw new Error(`Coverage token baseline missing task ${taskId}.`);
    }
    for (const taskId of actual) {
        if (!expected.includes(taskId))
            throw new Error(`Coverage token baseline includes unknown task ${taskId}.`);
    }
    if (actual.length !== actualSet.size)
        throw new Error("Coverage token baseline task IDs must be unique.");
}
function providerModelsMeasured(report) {
    const models = [];
    for (const match of report.matchAll(/`((?:openai|anthropic|gemini):[^`]+)`/g)) {
        const model = match[1];
        if (model && !models.includes(model))
            models.push(model);
    }
    return models;
}
export async function resolveCoverageBaselineSourceCommit(cwd) {
    try {
        const result = await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
            ...(cwd ? { cwd } : {}),
        });
        const commit = result.stdout.trim();
        if (!commit)
            throw new Error("git rev-parse returned an empty commit.");
        return commit;
    }
    catch (caught) {
        const detail = caught instanceof Error ? ` ${caught.message}` : "";
        throw new Error(`Cannot record coverage token baseline without git source commit${cwd ? ` from ${cwd}` : ""}.${detail}`, { cause: caught });
    }
}
function requiredString(value, label) {
    const parsed = stringValue(value);
    if (!parsed)
        throw new Error(`Coverage token baseline ${label} is required.`);
    return parsed;
}
function stringValue(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function integerValue(value, label) {
    if (!Number.isInteger(value) || Number(value) < 0) {
        throw new Error(`Coverage token baseline ${label} must be a non-negative integer.`);
    }
    return Number(value);
}
function stringArray(value, label) {
    if (!Array.isArray(value) || value.some((entry) => !stringValue(entry))) {
        throw new Error(`Coverage token baseline ${label} must be a string array.`);
    }
    return value.map((entry) => String(entry));
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=baseline.js.map