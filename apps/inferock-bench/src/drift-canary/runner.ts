import { randomUUID } from "node:crypto";
import {
  GEMINI_DEVELOPER_API_PLANE,
  lookupPrice,
  lookupPriceForEvent,
  roundUsd,
  type Provider,
} from "@inferock/measure/pricing";
import { normalizeCanonicalEvent, type CanonicalEventNormalized } from "@inferock/measure/canonical-event";
import { createBenchApp } from "../proxy.js";
import {
  type BenchSummaryOptions,
  wholeCallStandardFloorKey,
  wholeCallStandardFloorsForBenchEvents,
  type TimeWindow,
} from "../summary.js";
import type { EventStore, StoredBenchEvent } from "../storage.js";
import type { CoverageSelectedModel } from "../coverage-suite/estimate.js";
import { BenchRequestAnnotationRegistry } from "../coverage-suite/runner-annotations.js";
import {
  dollarizeDriftCanaryRegression,
  type DriftCanaryAffectedCall,
  type DriftCanaryDollarizationResult,
} from "./dollarization.js";
import { gradeDriftCanaryResponse, type DriftCanaryGradeResult } from "./grader.js";
import {
  DRIFT_CANARY_ESTIMATED_USAGE,
  DRIFT_CANARY_WORKLOAD_CLASS,
  driftCanaryEffectiveProtocol,
  driftCanaryItemIdFromSuiteTaskId,
  driftCanarySuiteTaskId,
  type DriftCanaryEffectiveProtocol,
  type DriftCanaryItem,
  type DriftCanaryProvider,
  type LoadedDriftCanaryManifest,
} from "./manifest.js";
import { flagDriftByAccuracyDrop, type DriftAccuracyFlagResult } from "./stats.js";
import { openRouterPlaneForModel } from "../openrouter-pins.js";

export const DRIFT_CANARY_PROGRESS_TASK_ID = "drift_canary";

export type DriftCanaryRunnerStatus = "completed" | "killed" | "failed";
export type DriftCanaryModelStatus =
  | "baseline_collecting"
  | "watched_clean"
  | "drift_flagged"
  | "incomplete";

export interface DriftCanaryBudgetState {
  readonly status: DriftCanaryRunnerStatus;
  readonly statusReason?: string;
}

export interface DriftCanaryItemResult {
  readonly itemId: string;
  readonly dataset: DriftCanaryItem["dataset"];
  readonly expectedAnswer: string;
  readonly extractedAnswer: string | null;
  readonly passed: boolean;
  readonly responseText: string;
  readonly requestId: string;
  readonly servedModel: string;
  readonly systemFingerprint?: string;
  readonly costUsd?: number;
  readonly startedAt: string;
  readonly endedAt: string;
}

export interface DriftCanaryAccuracyRun {
  readonly runId: string;
  readonly protocolVersion: string;
  readonly passed: number;
  readonly total: number;
  readonly accuracy: number;
  readonly startedAt: string;
  readonly endedAt: string;
}

export interface DriftCanaryModelResult {
  readonly provider: Provider;
  readonly model: string;
  readonly status: DriftCanaryModelStatus;
  readonly manifestHash: string;
  readonly protocolVersion: string;
  readonly effectiveProtocol: DriftCanaryEffectiveProtocol;
  readonly currentRun?: DriftCanaryAccuracyRun;
  readonly baseline?: {
    readonly protocolVersion: string;
    readonly runIds: readonly string[];
    readonly passed: number;
    readonly total: number;
    readonly accuracy: number;
  };
  readonly baselineCollection?: {
    readonly completedPriorRuns: number;
    readonly requiredRuns: number;
  };
  readonly stats?: DriftAccuracyFlagResult;
  readonly itemResults: readonly DriftCanaryItemResult[];
  readonly dollarization?: DriftCanaryDollarizationResult;
}

export interface DriftCanaryRunResult {
  readonly status: DriftCanaryRunnerStatus;
  readonly statusReason?: string;
  readonly runId: string;
  readonly manifestHash: string;
  readonly callsLaunched: number;
  readonly plannedCallCount: number;
  readonly models: readonly DriftCanaryModelResult[];
}

export interface PlannedDriftCanaryCall {
  readonly selectedModel: DriftCanarySelectedModel;
  readonly item: DriftCanaryItem;
  readonly estimatedCostUsd: number;
}

type DriftCanarySelectedModel = CoverageSelectedModel & {
  readonly provider: DriftCanaryProvider;
};

export async function runDriftCanary(input: {
  readonly runId: string;
  readonly manifest: LoadedDriftCanaryManifest;
  readonly app: ReturnType<typeof createBenchApp>;
  readonly registry: BenchRequestAnnotationRegistry;
  readonly benchKey: string;
  readonly selectedModels: readonly CoverageSelectedModel[];
  readonly store: EventStore;
  readonly eventTime: string;
  readonly summaryOptions?: BenchSummaryOptions;
  readonly budget?: {
    readonly preLaunch?: (calls: readonly PlannedDriftCanaryCall[]) => Promise<DriftCanaryBudgetState>;
    readonly postCall?: () => Promise<DriftCanaryBudgetState>;
  };
  readonly abortSignal?: AbortSignal;
}): Promise<DriftCanaryRunResult> {
  const plannedCalls = buildPlannedDriftCanaryCalls({
    manifest: input.manifest,
    selectedModels: input.selectedModels,
    eventTime: input.eventTime,
  });
  let callsLaunched = 0;

  for (const call of plannedCalls) {
    if (input.abortSignal?.aborted) {
      return {
        status: callsLaunched === 0 ? "killed" : "killed",
        statusReason: "aborted_by_user",
        runId: input.runId,
        manifestHash: input.manifest.manifestHash,
        callsLaunched,
        plannedCallCount: plannedCalls.length,
        models: await evaluateDriftCanaryModels(input),
      };
    }
    const budget = await input.budget?.preLaunch?.([call]);
    if (budget && budget.status !== "completed") {
      return {
        ...budget,
        runId: input.runId,
        manifestHash: input.manifest.manifestHash,
        callsLaunched,
        plannedCallCount: plannedCalls.length,
        models: await evaluateDriftCanaryModels(input),
      };
    }

    callsLaunched += 1;
    await executeDriftCanaryCall({
      app: input.app,
      registry: input.registry,
      runId: input.runId,
      benchKey: input.benchKey,
      manifest: input.manifest,
      call,
    });

    const postCall = await input.budget?.postCall?.();
    if (postCall && postCall.status !== "completed") {
      return {
        ...postCall,
        runId: input.runId,
        manifestHash: input.manifest.manifestHash,
        callsLaunched,
        plannedCallCount: plannedCalls.length,
        models: await evaluateDriftCanaryModels(input),
      };
    }
  }

  return {
    status: "completed",
    runId: input.runId,
    manifestHash: input.manifest.manifestHash,
    callsLaunched,
    plannedCallCount: plannedCalls.length,
    models: await evaluateDriftCanaryModels(input),
  };
}

export function buildPlannedDriftCanaryCalls(input: {
  readonly manifest: LoadedDriftCanaryManifest;
  readonly selectedModels: readonly CoverageSelectedModel[];
  readonly eventTime: string;
}): PlannedDriftCanaryCall[] {
  return input.selectedModels.filter(isDriftCanarySelectedModel).flatMap((selectedModel) => {
    const price = lookupPrice({
      provider: selectedModel.provider,
      model: selectedModel.model,
      eventTime: input.eventTime,
      ...(providerPlane(selectedModel.provider, selectedModel.model)
        ? { plane: providerPlane(selectedModel.provider, selectedModel.model) }
        : {}),
      usage: DRIFT_CANARY_ESTIMATED_USAGE,
    });
    if (!price.ok || price.pricingStatus === "partial") {
      throw new Error(`Drift canary cannot bound spend for ${selectedModel.provider}:${selectedModel.model}.`);
    }
    return input.manifest.items.map((item) => ({
      selectedModel,
      item,
      estimatedCostUsd: price.expectedChargeUsd,
    }));
  });
}

async function executeDriftCanaryCall(input: {
  readonly app: ReturnType<typeof createBenchApp>;
  readonly registry: BenchRequestAnnotationRegistry;
  readonly runId: string;
  readonly benchKey: string;
  readonly manifest: LoadedDriftCanaryManifest;
  readonly call: PlannedDriftCanaryCall;
}): Promise<void> {
  const requestId = randomUUID();
  const suiteTaskId = driftCanarySuiteTaskId(input.call.item.itemId);
  const effectiveProtocol = driftCanaryEffectiveProtocol(input.manifest, input.call.selectedModel);
  input.registry.register(requestId, {
    runId: input.runId,
    suiteTaskId,
    workloadClass: DRIFT_CANARY_WORKLOAD_CLASS,
    driftCanaryProtocolVersion: effectiveProtocol.protocolVersion,
  });

  const response = await input.app.request(routePath(input.call.selectedModel.provider, input.call.selectedModel.model), {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.benchKey}`,
      "content-type": "application/json",
      "x-inferock-request-id": requestId,
    },
    body: JSON.stringify(requestBodyForCanaryCall(input.manifest, input.call, effectiveProtocol)),
  });
  await response.arrayBuffer();
  if (response.status >= 400) {
    throw new Error(`drift canary item ${input.call.item.itemId} failed through local proxy with HTTP ${response.status}`);
  }
}

async function evaluateDriftCanaryModels(input: {
  readonly runId: string;
  readonly manifest: LoadedDriftCanaryManifest;
  readonly selectedModels: readonly CoverageSelectedModel[];
  readonly store: EventStore;
  readonly summaryOptions?: BenchSummaryOptions;
}): Promise<readonly DriftCanaryModelResult[]> {
  const records = await input.store.readAll();
  return input.selectedModels.filter(isDriftCanarySelectedModel).map((selected) =>
    evaluateDriftCanaryModel({
      runId: input.runId,
      manifest: input.manifest,
      selectedModel: selected,
      records,
      summaryOptions: input.summaryOptions,
    })
  );
}

function evaluateDriftCanaryModel(input: {
  readonly runId: string;
  readonly manifest: LoadedDriftCanaryManifest;
  readonly selectedModel: DriftCanarySelectedModel;
  readonly records: readonly StoredBenchEvent[];
  readonly summaryOptions?: BenchSummaryOptions;
}): DriftCanaryModelResult {
  const effectiveProtocol = driftCanaryEffectiveProtocol(input.manifest, input.selectedModel);
  const itemById = new Map(input.manifest.items.map((item) => [item.itemId, item]));
  const evaluated = input.records.flatMap((record) =>
    evaluatedCanaryRecord(record, itemById, input.selectedModel, effectiveProtocol.protocolVersion) ?? []
  );
  const completeRuns = completeCanaryRuns(input.manifest, evaluated, effectiveProtocol.protocolVersion);
  const currentRun = completeRuns.find((run) => run.runId === input.runId);
  if (!currentRun) {
    return {
      provider: input.selectedModel.provider,
      model: input.selectedModel.model,
      status: "incomplete",
      manifestHash: input.manifest.manifestHash,
      protocolVersion: effectiveProtocol.protocolVersion,
      effectiveProtocol,
      itemResults: evaluated
        .filter((record) => record.runId === input.runId)
        .map((record) => record.itemResult),
    };
  }

  const currentIndex = completeRuns.findIndex((run) => run.runId === input.runId);
  const baselineRuns = completeRuns.slice(0, input.manifest.baselineRunCount);
  if (currentIndex < input.manifest.baselineRunCount || baselineRuns.length < input.manifest.baselineRunCount) {
    const priorBaselineRuns = completeRuns.slice(0, Math.min(currentIndex, input.manifest.baselineRunCount));
    return {
      provider: input.selectedModel.provider,
      model: input.selectedModel.model,
      status: "baseline_collecting",
      manifestHash: input.manifest.manifestHash,
      protocolVersion: effectiveProtocol.protocolVersion,
      effectiveProtocol,
      currentRun: publicRun(currentRun),
      baselineCollection: {
        completedPriorRuns: priorBaselineRuns.length,
        requiredRuns: input.manifest.baselineRunCount,
      },
      itemResults: currentRun.itemResults,
    };
  }

  const baseline = aggregateBaseline(baselineRuns);
  if (!baseline) {
    throw new Error("Drift canary baseline aggregation failed despite enough complete runs.");
  }
  const stats = flagDriftByAccuracyDrop({
    baselinePassed: baseline.passed,
    baselineTotal: baseline.total,
    currentPassed: currentRun.passed,
    currentTotal: currentRun.total,
    alpha: input.manifest.alpha,
  });
  const status: DriftCanaryModelStatus = stats.flagged ? "drift_flagged" : "watched_clean";
  const result: DriftCanaryModelResult = {
    provider: input.selectedModel.provider,
    model: input.selectedModel.model,
    status,
    manifestHash: input.manifest.manifestHash,
    protocolVersion: effectiveProtocol.protocolVersion,
    effectiveProtocol,
    currentRun: publicRun(currentRun),
    baseline,
    stats,
    itemResults: currentRun.itemResults,
  };
  if (!stats.flagged) return result;

  const lastGood = lastGoodRun({
    completeRuns,
    currentIndex,
    baseline,
    baselineRunCount: input.manifest.baselineRunCount,
    alpha: input.manifest.alpha,
  });
  const affectedCalls = driftCanaryAffectedCallsInWindow(input.records, {
    provider: input.selectedModel.provider,
    model: input.selectedModel.model,
    since: lastGood.endedAt,
    until: currentRun.endedAt,
    floorSummaryWindow: { runId: input.runId },
    summaryOptions: input.summaryOptions,
  });
  return {
    ...result,
    dollarization: dollarizeDriftCanaryRegression({
      provider: input.selectedModel.provider,
      model: input.selectedModel.model,
      baseline,
      current: publicRun(currentRun),
      alpha: input.manifest.alpha,
      pValue: stats.pValue,
      lastGoodRunId: lastGood.runId,
      firstFlaggedRunId: currentRun.runId,
      window: {
        since: lastGood.endedAt,
        until: currentRun.endedAt,
      },
      affectedCalls,
    }),
  };
}

function evaluatedCanaryRecord(
  record: StoredBenchEvent,
  itemById: ReadonlyMap<string, DriftCanaryItem>,
  selectedModel: DriftCanarySelectedModel,
  protocolVersion: string,
): EvaluatedCanaryRecord | null {
  if (!record.runId) return null;
  if (record.driftCanaryProtocolVersion !== protocolVersion) return null;
  const itemId = driftCanaryItemIdFromSuiteTaskId(record.suiteTaskId);
  if (!itemId) return null;
  const item = itemById.get(itemId);
  if (!item) return null;
  const event = normalizeCanonicalEvent(record.event);
  if (event.request.provider !== selectedModel.provider || event.request.model !== selectedModel.model) return null;
  if (event.response.statusCode >= 400) return null;
  const grade = gradeDriftCanaryResponse({
    dataset: item.dataset,
    expectedAnswer: item.expectedAnswer,
    responseText: event.response.content,
  });
  return {
    runId: record.runId,
    item,
    event,
    grade,
    itemResult: itemResultForRecord(item, event, grade),
  };
}

function completeCanaryRuns(
  manifest: LoadedDriftCanaryManifest,
  records: readonly EvaluatedCanaryRecord[],
  protocolVersion: string,
): CompleteCanaryRun[] {
  const byRunId = new Map<string, EvaluatedCanaryRecord[]>();
  for (const record of records) {
    byRunId.set(record.runId, [...(byRunId.get(record.runId) ?? []), record]);
  }

  const runs: CompleteCanaryRun[] = [];
  for (const [runId, runRecords] of byRunId.entries()) {
    const latestByItem = new Map<string, EvaluatedCanaryRecord>();
    for (const record of runRecords) {
      const existing = latestByItem.get(record.item.itemId);
      if (!existing || record.event.timing.startedAt >= existing.event.timing.startedAt) {
        latestByItem.set(record.item.itemId, record);
      }
    }
    const orderedRecords = manifest.items.map((item) => latestByItem.get(item.itemId));
    if (orderedRecords.some((record) => record === undefined)) continue;
    const itemResults = orderedRecords.map((record) => {
      if (!record) throw new Error("unreachable complete drift canary record gap");
      return record.itemResult;
    });
    runs.push({
      runId,
      protocolVersion,
      itemResults,
      passed: itemResults.filter((item) => item.passed).length,
      total: itemResults.length,
      accuracy: itemResults.filter((item) => item.passed).length / itemResults.length,
      startedAt: minIso(itemResults.map((item) => item.startedAt)),
      endedAt: maxIso(itemResults.map((item) => item.endedAt)),
    });
  }
  return runs.sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId)
  );
}

function aggregateBaseline(
  runs: readonly CompleteCanaryRun[],
): DriftCanaryModelResult["baseline"] | undefined {
  if (runs.length === 0) return undefined;
  const passed = sum(runs.map((run) => run.passed));
  const total = sum(runs.map((run) => run.total));
  return {
    protocolVersion: runs[0].protocolVersion,
    runIds: runs.map((run) => run.runId),
    passed,
    total,
    accuracy: passed / total,
  };
}

function lastGoodRun(input: {
  readonly completeRuns: readonly CompleteCanaryRun[];
  readonly currentIndex: number;
  readonly baseline: NonNullable<DriftCanaryModelResult["baseline"]>;
  readonly baselineRunCount: number;
  readonly alpha: number;
}): CompleteCanaryRun {
  const baselineLast = input.completeRuns[input.baselineRunCount - 1];
  if (!baselineLast) throw new Error("Drift canary baseline has no last run.");
  let lastGood = baselineLast;
  for (const run of input.completeRuns.slice(input.baselineRunCount, input.currentIndex)) {
    const stats = flagDriftByAccuracyDrop({
      baselinePassed: input.baseline.passed,
      baselineTotal: input.baseline.total,
      currentPassed: run.passed,
      currentTotal: run.total,
      alpha: input.alpha,
    });
    if (!stats.flagged) lastGood = run;
  }
  return lastGood;
}

export function driftCanaryAffectedCallsInWindow(
  records: readonly StoredBenchEvent[],
  input: {
    readonly provider: Provider;
    readonly model: string;
    readonly since: string;
    readonly until: string;
    readonly floorSummaryWindow?: TimeWindow;
    readonly summaryOptions?: BenchSummaryOptions;
  },
): DriftCanaryAffectedCall[] {
  const affected: DriftCanaryAffectedCall[] = [];
  const existingFloors = wholeCallStandardFloorsForBenchEvents(
    records,
    input.floorSummaryWindow ?? {},
    input.summaryOptions,
  );
  for (const record of records) {
    const event = normalizeCanonicalEvent(record.event);
    if (event.request.provider !== input.provider || event.request.model !== input.model) continue;
    if (event.timing.startedAt <= input.since || event.timing.startedAt > input.until) continue;
    const costUsd = eventCostUsd(event);
    if (costUsd === null) continue;
    const existingFloor = existingFloors.get(wholeCallStandardFloorKey({
      tenantId: event.request.tenantId,
      provider: event.request.provider,
      requestId: event.request.requestId,
      startedAt: event.timing.startedAt,
      endedAt: event.timing.endedAt,
    }));
    affected.push({
      requestId: event.request.requestId,
      kind: driftCanaryItemIdFromSuiteTaskId(record.suiteTaskId) ? "canary" as const : "customer" as const,
      costUsd,
      ...(existingFloor
        ? {
          appliedCostUsd: 0,
          supersededByExistingFloor: {
            signalCode: existingFloor.signalCode,
            standardLossUsd: existingFloor.standardLossUsd,
            standardLossMethod: existingFloor.standardLossMethod,
          },
        }
        : {}),
    });
  }
  return affected;
}

function itemResultForRecord(
  item: DriftCanaryItem,
  event: CanonicalEventNormalized,
  grade: DriftCanaryGradeResult,
): DriftCanaryItemResult {
  const costUsd = eventCostUsd(event);
  return {
    itemId: item.itemId,
    dataset: item.dataset,
    expectedAnswer: grade.expectedAnswer,
    extractedAnswer: grade.extractedAnswer,
    passed: grade.passed,
    responseText: event.response.content,
    requestId: event.request.requestId,
    servedModel: event.response.servedModel,
    ...(event.response.systemFingerprint ? { systemFingerprint: event.response.systemFingerprint } : {}),
    ...(costUsd !== null ? { costUsd } : {}),
    startedAt: event.timing.startedAt,
    endedAt: event.timing.endedAt,
  };
}

function eventCostUsd(event: CanonicalEventNormalized): number | null {
  const price = lookupPriceForEvent(event);
  if (!price.ok || price.pricingStatus === "partial") return null;
  return roundUsd(price.expectedChargeUsd);
}

function requestBodyForCanaryCall(
  manifest: LoadedDriftCanaryManifest,
  call: PlannedDriftCanaryCall,
  effectiveProtocol: DriftCanaryEffectiveProtocol = driftCanaryEffectiveProtocol(manifest, call.selectedModel),
): Record<string, unknown> {
  const userPrompt = promptForCanaryItem(call.item);
  if (call.selectedModel.provider === "anthropic") {
    // Anthropic documents rejected sampling fields on Claude 4.7+/5; those canaries use provider-default temperature.
    // https://docs.anthropic.com/en/api/prompt-validation
    return {
      model: call.selectedModel.model,
      ...(effectiveProtocol.temperatureMode === "fixed_0" ? { temperature: manifest.protocol.temperature } : {}),
      max_tokens: effectiveProtocol.maxTokenBound,
      system: manifest.protocol.systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    };
  }
  if (call.selectedModel.provider === "gemini") {
    return {
      model: call.selectedModel.model,
      generationConfig: {
        ...(effectiveProtocol.temperatureMode === "fixed_0" ? { temperature: manifest.protocol.temperature } : {}),
        maxOutputTokens: effectiveProtocol.maxTokenBound,
      },
      systemInstruction: {
        parts: [{ text: manifest.protocol.systemPrompt }],
      },
      contents: [{
        role: "user",
        parts: [{ text: userPrompt }],
      }],
    };
  }
  if (effectiveProtocol.maxTokenParameter === "max_completion_tokens") {
    // GPT-5/o canaries use Chat Completions reasoning-compatible token fields and provider-default temperature.
    // https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/
    // https://developers.openai.com/api/docs/guides/reasoning
    return {
      model: call.selectedModel.model,
      max_completion_tokens: effectiveProtocol.maxTokenBound,
      messages: [
        { role: "system", content: manifest.protocol.systemPrompt },
        { role: "user", content: userPrompt },
      ],
    };
  }
  return {
    model: call.selectedModel.model,
    ...(effectiveProtocol.temperatureMode === "fixed_0" ? { temperature: manifest.protocol.temperature } : {}),
    max_tokens: effectiveProtocol.maxTokenBound,
    messages: [
      { role: "system", content: manifest.protocol.systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
}

export const __driftCanaryTestHooks = {
  evaluateDriftCanaryModel,
  driftCanaryEffectiveProtocol,
  requestBodyForCanaryCall,
};

function promptForCanaryItem(item: DriftCanaryItem): string {
  if (item.dataset === "mmlu_hendrycks_test") {
    return [
      item.question,
      "",
      `A. ${item.choices.A}`,
      `B. ${item.choices.B}`,
      `C. ${item.choices.C}`,
      `D. ${item.choices.D}`,
      "",
      "Return only A, B, C, or D.",
    ].join("\n");
  }
  return `${item.question}\n\nReturn only the final numeric answer.`;
}

function routePath(provider: DriftCanaryProvider, model?: string): string {
  if (provider === "anthropic") return "/v1/messages";
  if (provider === "gemini") return `/v1beta/${geminiModelPath(model ?? "models/provider_default")}:generateContent`;
  if (provider === "openrouter") return "/openrouter/v1/chat/completions";
  return "/v1/chat/completions";
}

function isDriftCanarySelectedModel(model: CoverageSelectedModel): model is DriftCanarySelectedModel {
  return model.provider === "openai" ||
    model.provider === "anthropic" ||
    model.provider === "gemini" ||
    model.provider === "openrouter";
}

function geminiModelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function providerPlane(provider: Provider, model?: string): string | undefined {
  if (provider === "gemini") return GEMINI_DEVELOPER_API_PLANE;
  if (provider === "openrouter") return openRouterPlaneForModel(model);
  return undefined;
}

function publicRun(run: CompleteCanaryRun): DriftCanaryAccuracyRun {
  return {
    runId: run.runId,
    protocolVersion: run.protocolVersion,
    passed: run.passed,
    total: run.total,
    accuracy: run.accuracy,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
  };
}

function minIso(values: readonly string[]): string {
  return values.reduce((min, value) => value < min ? value : min);
}

function maxIso(values: readonly string[]): string {
  return values.reduce((max, value) => value > max ? value : max);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

interface EvaluatedCanaryRecord {
  readonly runId: string;
  readonly item: DriftCanaryItem;
  readonly event: CanonicalEventNormalized;
  readonly grade: DriftCanaryGradeResult;
  readonly itemResult: DriftCanaryItemResult;
}

interface CompleteCanaryRun extends DriftCanaryAccuracyRun {
  readonly itemResults: readonly DriftCanaryItemResult[];
}
