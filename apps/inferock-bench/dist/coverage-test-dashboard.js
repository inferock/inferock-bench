import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { listPricedModelOptions, roundUsd, } from "@inferock/measure/pricing";
import { providerApiKey, } from "./config.js";
import { loadCoverageTokenBaseline, } from "./coverage-suite/baseline.js";
import { CoverageEstimateError, estimateCoverageSuite, resolveCoverageModelPreset, } from "./coverage-suite/estimate.js";
import { loadCoverageSuiteManifest, } from "./coverage-suite/manifest.js";
import { migrateSpeedTestReceiptBundle, renderSpeedTestReceipt, } from "./coverage-suite/runner.js";
import { runProviderParallelCoverageSuite } from "./coverage-suite/provider-parallel-runner.js";
import { agentInstallConsentText, planAgentProvisioning } from "./agent-mode/provisioner.js";
import { AgentProvisioningFailureError } from "./agent-mode/provisioner.js";
import { DRIFT_CANARY_PROGRESS_TASK_ID } from "./drift-canary/runner.js";
import { isProviderName, PROVIDER_NAMES } from "./provider.js";
import { parseJsonRecord, stringValue } from "./record.js";
import { providerScopedCoverageTotalSurfaceCount, summarizeBenchEvents, } from "./summary.js";
const COVERAGE_TEST_BASELINE_NOT_MEASURED = "baseline not measured yet: run `inferock-bench test --record-baseline` with explicit consent to produce a real per-task token baseline.";
export function createCoverageTestController(input) {
    return new CoverageTestController(input);
}
export class CoverageTestController {
    input;
    runs = new Map();
    constructor(input) {
        this.input = input;
    }
    async optionsResponse() {
        const suite = await this.loadSuite();
        const configuredProviders = this.configuredProviders();
        const latestRun = this.latestRun();
        const modelOptions = listPricedModelOptions({ eventTime: new Date().toISOString() })
            .filter((option) => configuredProviders.includes(option.provider))
            .filter((option) => requiredRoutesForProvider(suite, option.provider)
            .every((route) => option.routeCapabilities.includes(route)))
            .map((option) => ({
            provider: option.provider,
            model: option.model,
            routeCapabilities: [...option.routeCapabilities],
            pricingVersion: option.pricingVersion,
            source: option.source,
            pricingStatus: option.pricingStatus,
        }));
        const baseline = await this.loadBaseline(suite);
        const base = {
            setup: {
                configuredProviders,
                missingProviders: PROVIDER_NAMES.filter((provider) => !configuredProviders.includes(provider)),
            },
            suite: {
                suiteVersion: suite.suiteVersion,
                methodVersion: suite.methodVersion,
                taskCount: suite.tasks.length,
                surfaceCount: suite.surfaces.length,
                defaultGenerator: suite.defaultGenerator,
            },
            providerOptions: modelOptions,
            generatorOptions: [
                { value: "built-in", label: "Built-in" },
                { value: "agent", label: "Real coding agent" },
            ],
            providerScopeOptions: {
                default: "all_configured",
                configuredProviders,
            },
            latestRun: latestRun ? {
                runId: latestRun.runId,
                status: latestRun.status,
                receiptReady: Boolean(latestRun.receipt),
            } : null,
        };
        if (configuredProviders.length === 0) {
            return jsonResponse({
                ...base,
                runnable: false,
                disabledReason: "provider_key_needed",
                disabledMessage: "Provider key needed before the coverage test can run.",
                baseline: baselineStatusPayload(baseline),
            });
        }
        if (!baseline.ok) {
            return jsonResponse({
                ...base,
                runnable: false,
                disabledReason: baseline.disabledReason,
                disabledMessage: baseline.message,
                baseline: baselineStatusPayload(baseline),
            });
        }
        try {
            const selectedModels = resolveCoverageModelPreset({
                configuredProviders,
                suite,
                baseline: baseline.baseline,
                eventTime: new Date().toISOString(),
            });
            const estimate = this.estimateFor({
                suite,
                baseline: baseline.baseline,
                request: { selectedModels, generator: suite.defaultGenerator },
            });
            return jsonResponse({
                ...base,
                runnable: true,
                baseline: baselineStatusPayload(baseline),
                defaults: {
                    selectedModels: estimate.selectedModels,
                    generator: estimate.generator,
                    spendCapUsd: estimate.spendCapUsd,
                },
                estimate: estimatePayload(estimate),
                estimateLine: estimateLine(estimate),
            });
        }
        catch (error) {
            return jsonResponse({
                ...base,
                runnable: false,
                disabledReason: "pricing_unknown",
                disabledMessage: errorMessage(error),
                baseline: baselineStatusPayload(baseline),
            });
        }
    }
    async estimateResponse(request) {
        const parsed = parseEstimateRequest(await request.text());
        if (!parsed.ok) {
            return jsonResponse({ error: "invalid_request", message: parsed.message }, 400);
        }
        const context = await this.estimateContext(parsed.request);
        if (!context.ok) {
            return jsonResponse({ error: context.error, message: context.message }, context.status);
        }
        return jsonResponse({
            estimate: estimatePayload(context.context.estimate),
            consentHash: context.context.estimate.estimateHash,
            consentToken: context.context.estimate.estimateHash,
            estimateLine: estimateLine(context.context.estimate),
            consent: consentPayload(context.context.estimate, context.context.baseline),
            ...(context.context.generator === "agent" && this.input.paths
                ? { agentInstall: agentInstallPayload(this.input.paths.homeDir) }
                : {}),
        });
    }
    async startResponse(request) {
        const parsed = parseStartRequest(await request.text());
        if (!parsed.ok) {
            return jsonResponse({ error: "invalid_request", message: parsed.message }, 400);
        }
        if ([...this.runs.values()].some(runBlocksNewStarts)) {
            return jsonResponse({
                error: "run_already_active",
                message: "A coverage test is already running.",
            }, 409);
        }
        const context = await this.estimateContext(parsed.request);
        if (!context.ok) {
            return jsonResponse({ error: context.error, message: context.message }, context.status);
        }
        if (parsed.consentHash !== context.context.estimate.estimateHash) {
            return jsonResponse({
                error: "consent_hash_mismatch",
                message: "Consent hash does not match the current provider/model/generator/suite/baseline/cap estimate.",
            }, 409);
        }
        const agentInstall = context.context.generator === "agent" && this.input.paths
            ? agentInstallPayload(this.input.paths.homeDir)
            : undefined;
        if (context.context.generator === "agent") {
            if (!this.input.paths) {
                return jsonResponse({
                    error: "agent_install_unavailable",
                    message: "Agent auto-provisioning requires a local bench home path.",
                }, 503);
            }
            if (parsed.agentInstallConsentHash !== agentInstall?.consentHash) {
                return jsonResponse({
                    error: "agent_install_consent_required",
                    message: `Agent install consent hash is required. Expected ${agentInstall?.consentHash ?? "unknown"}.`,
                    agentInstall,
                }, 409);
            }
        }
        const run = this.createRun(context.context);
        this.runs.set(run.runId, run);
        await this.publishSnapshot(run);
        void this.executeRun(run).catch((error) => {
            run.status = "failed";
            run.statusReason = errorMessage(error);
            run.fallbackOffer = fallbackOfferFromError(error);
            run.endedAt = new Date().toISOString();
            void this.publishSnapshot(run);
        });
        return jsonResponse({ run: await this.snapshot(run) }, 202);
    }
    async runResponse(runId) {
        if (runId === "latest")
            return await this.latestRunResponse();
        const run = this.runs.get(runId);
        if (!run)
            return jsonResponse({ error: "run_not_found", message: "Coverage test run not found." }, 404);
        return jsonResponse(await this.snapshot(run));
    }
    async runsResponse() {
        return jsonResponse({ runs: await this.listRecentRuns() });
    }
    async latestRunResponse() {
        const run = this.latestRun();
        if (!run)
            return jsonResponse({ error: "run_not_found", message: "Coverage test run not found." }, 404);
        return jsonResponse(await this.snapshot(run));
    }
    async abortResponse(runId) {
        const run = this.runs.get(runId);
        if (!run)
            return jsonResponse({ error: "run_not_found", message: "Coverage test run not found." }, 404);
        if (run.status === "queued" || run.status === "running") {
            run.abortController.abort();
            run.status = "draining";
            run.statusReason = "aborted_by_user";
            await this.publishSnapshot(run);
        }
        return jsonResponse(await this.snapshot(run));
    }
    async receiptResponse(runId) {
        const run = this.runs.get(runId);
        const receipt = run?.receipt ?? await this.persistedReceipt(runId);
        if (!run && !receipt) {
            return jsonResponse({ error: "run_not_found", message: "Coverage test run not found." }, 404);
        }
        if (!receipt) {
            return jsonResponse({ error: "receipt_not_ready", message: "Coverage test receipt is not ready yet." }, 409);
        }
        return jsonResponse({
            bundle: receipt,
            compactText: renderSpeedTestReceipt(receipt),
        });
    }
    eventsResponse(runId) {
        const run = this.runs.get(runId);
        if (!run)
            return jsonResponse({ error: "run_not_found", message: "Coverage test run not found." }, 404);
        const encoder = new TextEncoder();
        let listener;
        const stream = new ReadableStream({
            start: (controller) => {
                const write = (event) => {
                    controller.enqueue(encoder.encode(formatSseEvent(event)));
                };
                for (const event of run.events)
                    write(event);
                if (isTerminalRunStatus(run.status)) {
                    controller.close();
                    return;
                }
                listener = write;
                run.listeners.add(listener);
            },
            cancel: () => {
                if (listener)
                    run.listeners.delete(listener);
            },
        });
        return new Response(stream, {
            headers: {
                "cache-control": "no-store",
                "content-type": "text/event-stream; charset=utf-8",
                "x-accel-buffering": "no",
            },
        });
    }
    async estimateContext(request) {
        const suite = await this.loadSuite();
        const baseline = await this.loadBaseline(suite);
        if (!baseline.ok) {
            return {
                ok: false,
                status: 409,
                error: baseline.disabledReason,
                message: baseline.message,
            };
        }
        const configuredProviders = this.configuredProviders();
        if (configuredProviders.length === 0) {
            return {
                ok: false,
                status: 409,
                error: "provider_key_needed",
                message: "Provider key needed before the coverage test can run.",
            };
        }
        const selectedModels = request.selectedModels ??
            resolveCoverageModelPreset({
                configuredProviders,
                suite,
                baseline: baseline.baseline,
                eventTime: new Date().toISOString(),
            });
        for (const selected of selectedModels) {
            if (!configuredProviders.includes(selected.provider)) {
                return {
                    ok: false,
                    status: 409,
                    error: "provider_key_needed",
                    message: `Provider key needed for ${selected.provider}.`,
                };
            }
        }
        try {
            const estimate = this.estimateFor({
                suite,
                baseline: baseline.baseline,
                request: {
                    ...request,
                    selectedModels,
                    generator: request.generator ?? suite.defaultGenerator,
                },
            });
            return {
                ok: true,
                context: {
                    suite,
                    baseline: baseline.baseline,
                    selectedModels: estimate.selectedModels,
                    generator: estimate.generator,
                    spendCapUsd: estimate.spendCapUsd,
                    estimate,
                },
            };
        }
        catch (error) {
            return {
                ok: false,
                status: error instanceof CoverageEstimateError ? 409 : 400,
                error: "estimate_unavailable",
                message: errorMessage(error),
            };
        }
    }
    estimateFor(input) {
        const generator = input.request.generator ?? input.suite.defaultGenerator;
        const selectedModels = input.request.selectedModels ?? resolveCoverageModelPreset({
            configuredProviders: this.configuredProviders(),
            suite: input.suite,
            baseline: input.baseline,
            eventTime: new Date().toISOString(),
        });
        const initial = estimateCoverageSuite({
            selectedModels,
            suite: input.suite,
            baseline: input.baseline,
            generator,
            spendCapUsd: input.request.spendCapUsd ?? 1,
            eventTime: new Date().toISOString(),
        });
        const spendCapUsd = input.request.spendCapUsd ??
            roundUsd(initial.estimatedUsd * input.suite.estimateDefaults.defaultSpendCapMultiplier);
        return input.request.spendCapUsd === undefined
            ? estimateCoverageSuite({
                selectedModels,
                suite: input.suite,
                baseline: input.baseline,
                generator,
                spendCapUsd,
                eventTime: new Date().toISOString(),
            })
            : initial;
    }
    createRun(context) {
        const tasks = new Map();
        for (const selected of context.estimate.selectedModels) {
            for (const task of context.suite.tasks) {
                const applicable = task.providerRoutes.some((route) => route.startsWith(`${selected.provider}:`));
                tasks.set(progressTaskKey(selected.provider, task.taskId), {
                    taskId: task.taskId,
                    provider: selected.provider,
                    label: task.taskId.replaceAll("_", " "),
                    applicable,
                    status: applicable ? "pending" : "skipped",
                    ...(applicable ? {} : { statusReason: `Not applicable to ${providerLabel(selected.provider)} job.` }),
                    callsStarted: 0,
                    callsCompleted: 0,
                    estimatedStartedUsd: 0,
                    estimatedCompletedUsd: 0,
                });
            }
            tasks.set(progressTaskKey(selected.provider, DRIFT_CANARY_PROGRESS_TASK_ID), {
                taskId: DRIFT_CANARY_PROGRESS_TASK_ID,
                provider: selected.provider,
                label: "drift canary",
                applicable: true,
                status: "pending",
                callsStarted: 0,
                callsCompleted: 0,
                estimatedStartedUsd: 0,
                estimatedCompletedUsd: 0,
            });
        }
        return {
            runId: `speedtest_${randomUUID()}`,
            suite: context.suite,
            baseline: context.baseline,
            estimate: context.estimate,
            abortController: new AbortController(),
            events: [],
            listeners: new Set(),
            tasks,
            plannedCallCount: 0,
            status: "queued",
            startedAt: new Date().toISOString(),
            drained: false,
        };
    }
    async executeRun(run) {
        if (run.status !== "draining")
            run.status = "running";
        await this.publishSnapshot(run);
        const result = await runProviderParallelCoverageSuite({
            runId: run.runId,
            suite: run.suite,
            baseline: run.baseline,
            estimate: run.estimate,
            config: this.input.config(),
            env: this.input.env,
            store: this.input.store,
            providerFetch: this.input.providerFetch,
            benchHome: this.input.paths?.homeDir ?? ".inferock-bench",
            agentInstallConsentHash: run.estimate.generator === "agent"
                ? planAgentProvisioning({ benchHome: this.input.paths?.homeDir ?? ".inferock-bench" }).consentHash
                : undefined,
            agentProvisioner: this.input.agentProvisioner,
            agentProcessRunner: this.input.agentProcessRunner,
            log: this.input.log,
            startedAt: run.startedAt,
            consentedAt: run.startedAt,
            abortSignal: run.abortController.signal,
            onProgress: async (event) => {
                this.applyProgressEvent(run, event);
                await this.publishSnapshot(run);
            },
        });
        run.status = result.receipt.run.status;
        run.statusReason = result.receipt.run.statusReason;
        run.receipt = result.receipt;
        run.endedAt = result.receipt.run.endedAt;
        await this.publishSnapshot(run);
    }
    applyProgressEvent(run, event) {
        if (event.type === "run_started") {
            run.plannedCallCount += event.plannedCallCount;
            return;
        }
        if (event.type === "task_started") {
            const task = run.tasks.get(progressTaskKey(event.provider, event.taskId));
            if (!task)
                return;
            task.status = "running";
            task.statusReason = undefined;
            task.callsStarted += event.callCount;
            task.estimatedStartedUsd = roundUsd(task.estimatedStartedUsd + (event.estimatedCostUsd || 0));
            return;
        }
        if (event.type === "task_completed") {
            const task = run.tasks.get(progressTaskKey(event.provider, event.taskId));
            if (!task)
                return;
            task.status = "completed";
            task.statusReason = undefined;
            task.callsCompleted += event.callCount;
            task.estimatedCompletedUsd = roundUsd(task.estimatedCompletedUsd + (event.estimatedCostUsd || 0));
            return;
        }
        if (event.type === "task_failed") {
            const task = run.tasks.get(progressTaskKey(event.provider, event.taskId));
            if (!task)
                return;
            task.status = "failed";
            task.statusReason = event.statusReason;
            return;
        }
        if (event.type === "run_completed") {
            for (const task of run.tasks.values()) {
                if (event.provider && task.provider !== event.provider)
                    continue;
                if (task.status === "pending") {
                    task.status = "skipped";
                    task.statusReason = skippedReasonForRunStatus(event.status, event.statusReason);
                }
            }
        }
        if (event.type === "run_drained") {
            run.drained = true;
        }
    }
    async snapshot(run) {
        const records = await this.input.store.readAll();
        const summary = summarizeBenchEvents(records, { runId: run.runId }, { config: this.input.config() });
        const tasks = [...run.tasks.values()];
        const callsStarted = tasks.reduce((total, task) => total + task.callsStarted, 0);
        const callsCompleted = tasks.reduce((total, task) => total + task.callsCompleted, 0);
        const estimatedStartedSpendUsd = roundUsd(tasks.reduce((total, task) => total + task.estimatedStartedUsd, 0));
        const estimatedCompletedSpendUsd = roundUsd(tasks.reduce((total, task) => total + task.estimatedCompletedUsd, 0));
        const startedSurfaceCount = new Set(tasks
            .filter((task) => task.applicable && task.status !== "pending")
            .map((task) => task.taskId)).size;
        const totalSurfaceCount = summary.measuredCalls > 0
            ? summary.coverage.totalSurfaceCount
            : providerScopedCoverageTotalSurfaceCount(run.estimate.selectedModels.map((model) => model.provider));
        return {
            runId: run.runId,
            status: run.status,
            ...(run.statusReason ? { statusReason: run.statusReason } : {}),
            startedAt: run.startedAt,
            ...(run.endedAt ? { endedAt: run.endedAt } : {}),
            suiteVersion: run.suite.suiteVersion,
            baselineVersion: run.baseline.baselineVersion,
            generator: run.estimate.generator,
            selectedModels: run.estimate.selectedModels,
            consentHash: run.estimate.estimateHash,
            estimate: estimatePayload(run.estimate),
            progress: {
                tasks: tasks.map((task) => ({
                    taskId: task.taskId,
                    provider: task.provider,
                    label: task.label,
                    status: task.status,
                    ...(task.statusReason ? { statusReason: task.statusReason } : {}),
                    callsStarted: task.callsStarted,
                    callsCompleted: task.callsCompleted,
                    estimatedStartedUsd: task.estimatedStartedUsd,
                    estimatedCompletedUsd: task.estimatedCompletedUsd,
                })),
                measuredCalls: Math.max(summary.measuredCalls, callsStarted),
                providerCallsStarted: callsStarted,
                providerCallsCompleted: Math.max(summary.measuredCalls, callsCompleted),
                plannedCallCount: Math.max(run.plannedCallCount, callsStarted, callsCompleted),
                actualSpendUsd: summary.providerSpendUsd,
                estimatedStartedSpendUsd,
                estimatedCompletedSpendUsd,
                capRemainingUsd: roundUsd(Math.max(0, run.estimate.spendCapUsd - Math.max(summary.providerSpendUsd, estimatedStartedSpendUsd))),
                spendCapUsd: run.estimate.spendCapUsd,
                surfacesWatchedCount: Math.max(summary.coverage.watchedCount, startedSurfaceCount),
                totalSurfaceCount,
                signalCount: summary.coverage.signalCount,
                notOpenableCount: summary.coverage.notOpenableCount,
            },
            receiptReady: Boolean(run.receipt),
            ...(run.fallbackOffer ? { fallbackOffer: run.fallbackOffer } : {}),
            drained: run.drained,
        };
    }
    async publishSnapshot(run) {
        const event = {
            event: "snapshot",
            data: await this.snapshot(run),
        };
        run.events.push(event);
        for (const listener of run.listeners)
            listener(event);
        if (isTerminalRunStatus(run.status))
            run.listeners.clear();
    }
    async loadSuite() {
        return this.input.coverageTest?.suite ?? await loadCoverageSuiteManifest();
    }
    async loadBaseline(suite) {
        if (this.input.coverageTest?.baseline)
            return { ok: true, baseline: this.input.coverageTest.baseline };
        try {
            return { ok: true, baseline: await loadCoverageTokenBaseline(this.input.coverageTest?.baselineUrl, suite) };
        }
        catch (error) {
            const message = errorMessage(error);
            if (/bootstrap_required|no measured samples|zero token usage|plannedCalls must be positive/i.test(message)) {
                return {
                    ok: false,
                    disabledReason: "baseline_not_measured",
                    message: COVERAGE_TEST_BASELINE_NOT_MEASURED,
                };
            }
            return {
                ok: false,
                disabledReason: "baseline_unavailable",
                message,
            };
        }
    }
    configuredProviders() {
        const config = this.input.config();
        const env = this.input.env ?? process.env;
        return PROVIDER_NAMES.filter((provider) => Boolean(providerApiKey(provider, config, env)));
    }
    latestRun() {
        return [...this.runs.values()]
            .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];
    }
    async listRecentRuns() {
        const inMemory = [...this.runs.values()].map((run) => ({
            runId: run.runId,
            status: run.status,
            startedAt: run.startedAt,
            ...(run.endedAt ? { endedAt: run.endedAt } : {}),
            receiptReady: Boolean(run.receipt),
            selectedModels: run.estimate.selectedModels.map((model) => ({ provider: model.provider, model: model.model })),
            ...(run.receipt ? {
                measuredCalls: run.receipt.totals.measuredCalls,
                standardLossUsd: run.receipt.totals.standardLossUsd,
            } : {}),
        }));
        const seen = new Set(inMemory.map((run) => run.runId));
        const persisted = (await this.persistedReceipts())
            .filter((receipt) => !seen.has(receipt.run.runId))
            .map((receipt) => ({
            runId: receipt.run.runId,
            status: receipt.run.status,
            startedAt: receipt.run.startedAt,
            endedAt: receipt.run.endedAt,
            receiptReady: true,
            selectedModels: receipt.run.selectedModels,
            measuredCalls: receipt.totals.measuredCalls,
            standardLossUsd: receipt.totals.standardLossUsd,
        }));
        return [...inMemory, ...persisted]
            .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
            .slice(0, 12);
    }
    async persistedReceipt(runId) {
        return (await this.persistedReceipts()).find((receipt) => receipt.run.runId === runId);
    }
    async persistedReceipts() {
        const receiptsDir = this.input.paths?.receiptsDir;
        if (!receiptsDir)
            return [];
        let filenames;
        try {
            filenames = await readdir(receiptsDir);
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ENOENT")
                return [];
            throw error;
        }
        const receipts = [];
        for (const filename of filenames) {
            if (!filename.startsWith("speedtest-") || !filename.endsWith(".json"))
                continue;
            try {
                const parsed = JSON.parse(await readFile(join(receiptsDir, filename), "utf8"));
                const migrated = migrateSpeedTestReceiptBundle(parsed);
                if (migrated)
                    receipts.push(migrated);
            }
            catch {
                continue;
            }
        }
        return receipts;
    }
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
function progressTaskKey(provider, taskId) {
    return `${provider ?? "unknown"}:${taskId}`;
}
function providerLabel(provider) {
    if (provider === "openai")
        return "OpenAI";
    if (provider === "anthropic")
        return "Anthropic";
    if (provider === "gemini")
        return "Gemini";
    if (provider === "openrouter")
        return "OpenRouter";
    return provider;
}
function requiredRoutesForProvider(suite, provider) {
    const routes = new Set();
    for (const task of suite.tasks) {
        for (const route of task.providerRoutes) {
            if (route.startsWith(`${provider}:`))
                routes.add(route.slice(provider.length + 1));
        }
    }
    return [...routes].sort();
}
function skippedReasonForRunStatus(status, statusReason) {
    if (status === "completed")
        return "This check was not needed after earlier steps finished.";
    if (status === "aborted_before_calls")
        return "Run stopped before provider calls started.";
    if (status === "killed")
        return statusReason ? `Run stopped before this check: ${statusReason}.` : "Run stopped before this check.";
    if (status === "failed")
        return statusReason ? `Run failed before this check: ${statusReason}.` : "Run failed before this check.";
    return "Run ended before this check.";
}
function parseEstimateRequest(raw) {
    const body = raw.trim() ? parseJsonRecord(raw) : {};
    if (!body)
        return { ok: false, message: "Request body must be a JSON object." };
    const selected = selectedModelsFromBody(body);
    if (!selected.ok)
        return { ok: false, message: selected.message };
    const generator = generatorFromBody(body);
    if (!generator.ok)
        return { ok: false, message: generator.message };
    const spendCapUsd = optionalPositiveNumber(body.spendCapUsd, "spendCapUsd");
    if (!spendCapUsd.ok)
        return { ok: false, message: spendCapUsd.message };
    return {
        ok: true,
        request: {
            ...(selected.selectedModels ? { selectedModels: selected.selectedModels } : {}),
            ...(generator.generator ? { generator: generator.generator } : {}),
            ...(spendCapUsd.value !== undefined ? { spendCapUsd: spendCapUsd.value } : {}),
        },
    };
}
function parseStartRequest(raw) {
    const estimate = parseEstimateRequest(raw);
    if (!estimate.ok)
        return estimate;
    const body = raw.trim() ? parseJsonRecord(raw) : {};
    if (!body)
        return { ok: false, message: "Request body must be a JSON object." };
    const consentHash = stringValue(body.consentHash) ?? stringValue(body.consentToken);
    if (!consentHash)
        return { ok: false, message: "consentHash is required." };
    const agentInstallConsentHash = stringValue(body.agentInstallConsentHash);
    return {
        ok: true,
        request: estimate.request,
        consentHash,
        ...(agentInstallConsentHash ? { agentInstallConsentHash } : {}),
    };
}
function selectedModelsFromBody(body) {
    if (Array.isArray(body.selectedModels)) {
        const selectedModels = [];
        for (const [index, value] of body.selectedModels.entries()) {
            if (!isJsonRecord(value))
                return { ok: false, message: `selectedModels[${index}] must be an object.` };
            const provider = stringValue(value.provider);
            const model = stringValue(value.model);
            if (!isProviderName(provider) || !model) {
                return { ok: false, message: `selectedModels[${index}] requires provider and model.` };
            }
            selectedModels.push({ provider, model });
        }
        if (selectedModels.length === 0)
            return { ok: false, message: "selectedModels must not be empty." };
        return { ok: true, selectedModels };
    }
    const provider = stringValue(body.provider);
    const model = stringValue(body.model);
    if (provider || model) {
        if (!isProviderName(provider) || !model) {
            return { ok: false, message: "provider and model must be supplied together." };
        }
        return { ok: true, selectedModels: [{ provider, model }] };
    }
    return { ok: true };
}
function generatorFromBody(body) {
    const value = stringValue(body.generator);
    if (!value)
        return { ok: true };
    if (value === "built-in" || value === "agent")
        return { ok: true, generator: value };
    return { ok: false, message: "generator must be built-in or agent." };
}
function optionalPositiveNumber(value, label) {
    if (value === undefined)
        return { ok: true };
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return { ok: false, message: `${label} must be a positive number.` };
    }
    return { ok: true, value };
}
function baselineStatusPayload(baseline) {
    if (!baseline.ok) {
        return {
            status: baseline.disabledReason === "baseline_not_measured" ? "bootstrap_required" : "unavailable",
            reason: baseline.message,
        };
    }
    return {
        status: "ready",
        baselineVersion: baseline.baseline.baselineVersion,
        baselineContentDigest: baseline.baseline.baselineContentDigest,
        provenance: baseline.baseline.provenance,
        quantile: baseline.baseline.quantile,
    };
}
function estimatePayload(estimate) {
    return {
        estimateHash: estimate.estimateHash,
        suiteVersion: estimate.suiteVersion,
        driftCanaryManifestHash: estimate.driftCanaryManifestHash,
        baselineVersion: estimate.baselineVersion,
        baselineContentDigest: estimate.baselineContentDigest,
        generator: estimate.generator,
        spendCapUsd: estimate.spendCapUsd,
        selectedModels: estimate.selectedModels,
        estimatedTokensByCategory: estimate.estimatedTokensByCategory,
        estimatedUsdByModel: estimate.estimatedUsdByModel,
        estimatedUsd: estimate.estimatedUsd,
        pricing: estimate.pricing,
    };
}
function consentPayload(estimate, baseline) {
    return {
        byokWarning: "Provider keys are not sent to Inferock; attached only to provider requests. The test spends from your provider account.",
        abortBeforeStarting: "Abort before starting makes zero provider calls.",
        spendCapNotice: "Already-started provider calls may still be billed if you abort during a run.",
        pricingSources: estimate.pricing,
        suiteVersion: estimate.suiteVersion,
        baselineVersion: estimate.baselineVersion,
        baselineProvenance: baseline.provenance,
    };
}
function estimateLine(estimate) {
    const tokens = Object.values(estimate.estimatedTokensByCategory)
        .reduce((total, value) => total + value, 0);
    const models = estimate.selectedModels
        .map((model) => `${model.provider}:${model.model}`)
        .join(", ");
    return `Running the complete test set on ${models} will cost approximately ${formatEstimateUsd(estimate.estimatedUsd)} · est. ${tokens.toLocaleString("en-US")} tokens`;
}
function agentInstallPayload(benchHome) {
    const plan = planAgentProvisioning({ benchHome });
    return {
        agent: plan.agent,
        benchVersion: plan.benchVersion,
        whyText: plan.whyText,
        platform: plan.platformLabel,
        packages: plan.packages,
        installRoot: plan.installRoot,
        executablePath: plan.executablePath,
        consentHash: plan.consentHash,
        consentText: agentInstallConsentText(plan),
    };
}
function formatEstimateUsd(value) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
    }).format(value);
}
function jsonResponse(body, status = 200) {
    return new Response(`${JSON.stringify(body)}\n`, {
        status,
        headers: {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
        },
    });
}
function formatSseEvent(event) {
    return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
function isTerminalRunStatus(status) {
    return status === "completed" ||
        status === "killed" ||
        status === "failed" ||
        status === "aborted_before_calls";
}
function runBlocksNewStarts(run) {
    return run.status === "queued" ||
        run.status === "running" ||
        run.status === "draining";
}
function errorMessage(error) {
    return error instanceof Error ? error.message : "coverage test request failed";
}
function fallbackOfferFromError(error) {
    if (!(error instanceof AgentProvisioningFailureError))
        return undefined;
    const detail = error.detail;
    return {
        generator: "built-in",
        label: "Run built-in driver instead",
        packageName: detail.packageName,
        packageVersion: detail.packageVersion,
        tarballUrl: detail.tarballUrl,
        platform: detail.platform,
        reason: detail.reason,
    };
}
function isJsonRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=coverage-test-dashboard.js.map