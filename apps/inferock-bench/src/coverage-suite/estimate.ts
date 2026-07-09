import {
  GEMINI_DEVELOPER_API_PLANE,
  listPricedModelOptions,
  lookupPrice,
  roundUsd,
  type Provider,
} from "@inferock/measure/pricing";
import type { CoverageGenerator, LoadedCoverageSuiteManifest } from "./manifest.js";
import {
  coverageBaselineContentDigest,
  normalizedUsageFromBaselineTask,
  type CoverageTokenBaselineTask,
  type LoadedCoverageTokenBaseline,
} from "./baseline.js";
import { stableSha256 } from "./canonical-json.js";
import {
  CHECKED_IN_DRIFT_CANARY_V1_MANIFEST_HASH,
  DRIFT_CANARY_ESTIMATED_USAGE,
  DRIFT_CANARY_ITEM_COUNT,
} from "../drift-canary/manifest.js";
import { openRouterPlaneForModel } from "../openrouter-pins.js";

export interface CoverageSelectedModel {
  readonly provider: Provider;
  readonly model: string;
  readonly presetPolicy?: "pricing-registry-cheapest-compatible";
}

export interface CoverageEstimateInput {
  readonly selectedModels: readonly CoverageSelectedModel[];
  readonly suite: LoadedCoverageSuiteManifest;
  readonly baseline: LoadedCoverageTokenBaseline;
  readonly generator: CoverageGenerator;
  readonly spendCapUsd: number;
  readonly eventTime: string;
}

export interface CoverageEstimate {
  readonly estimateHash: string;
  readonly suiteVersion: string;
  readonly driftCanaryManifestHash: string;
  readonly baselineVersion: string;
  readonly baselineContentDigest: string;
  readonly generator: CoverageGenerator;
  readonly spendCapUsd: number;
  readonly selectedModels: readonly CoverageSelectedModel[];
  readonly estimatedTokensByCategory: Readonly<Record<string, number>>;
  readonly estimatedUsdBand: CoverageEstimateBand;
  readonly estimatedUsdByModel: readonly {
    readonly provider: Provider;
    readonly model: string;
    readonly estimatedUsd: number;
    readonly plannedCalls: number;
    readonly estimatedUsdBand: CoverageEstimateBand;
    readonly plannedCallsBand: CoverageCallBand;
    readonly organicBudget?: CoverageOrganicBudgetEstimate;
  }[];
  readonly estimatedUsd: number;
  readonly pricing: readonly {
    readonly provider: Provider;
    readonly model: string;
    readonly pricingVersion: string;
    readonly source: string;
    readonly pricingStatus: "priced";
  }[];
}

export interface CoverageEstimateBand {
  readonly low: number;
  readonly expected: number;
  readonly high: number;
}

export interface CoverageCallBand {
  readonly low: number;
  readonly expected: number;
  readonly high: number;
}

export interface CoverageOrganicBudgetEstimate {
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

export interface ResolveCoverageModelPresetInput {
  readonly configuredProviders: readonly Provider[];
  readonly suite: LoadedCoverageSuiteManifest;
  readonly baseline: LoadedCoverageTokenBaseline;
  readonly eventTime: string;
}

export class CoverageEstimateError extends Error {}

export function resolveCoverageModelPreset(
  input: ResolveCoverageModelPresetInput,
): readonly CoverageSelectedModel[] {
  const selected: CoverageSelectedModel[] = [];
  for (const provider of uniqueProviders(input.configuredProviders)) {
    const requiredRoutes = requiredRoutesForProvider(input.suite, provider);
    const candidates = listPricedModelOptions({
      provider,
      eventTime: input.eventTime,
    })
      .filter((option) => requiredRoutes.every((route) => option.routeCapabilities.includes(route)));

    let cheapest: { readonly model: string; readonly estimatedUsd: number } | undefined;
    for (const candidate of candidates) {
      const estimatedUsd = estimateSingleModelUsd({
        provider,
        model: candidate.model,
        suite: input.suite,
        baseline: input.baseline,
        eventTime: input.eventTime,
      });
      if (
        !cheapest ||
        estimatedUsd < cheapest.estimatedUsd ||
        (estimatedUsd === cheapest.estimatedUsd && prefersConcreteModelId(candidate.model, cheapest.model))
      ) {
        cheapest = { model: candidate.model, estimatedUsd };
      }
    }

    if (!cheapest) {
      throw new CoverageEstimateError(`No priced compatible model for configured provider ${provider}.`);
    }
    selected.push({
      provider,
      model: cheapest.model,
      presetPolicy: "pricing-registry-cheapest-compatible",
    });
  }
  return selected;
}

function prefersConcreteModelId(candidate: string, current: string): boolean {
  return modelSpecificityScore(candidate) > modelSpecificityScore(current);
}

function modelSpecificityScore(model: string): number {
  if (/-\d{4}-\d{2}-\d{2}$/.test(model) || /-\d{8}$/.test(model)) return 2;
  if (/-latest$/.test(model)) return 1;
  return 0;
}

export function estimateCoverageSuite(input: CoverageEstimateInput): CoverageEstimate {
  if (input.baseline.suiteVersion !== input.suite.suiteVersion) {
    throw new CoverageEstimateError("Coverage estimate baseline suiteVersion does not match suite.");
  }
  if (input.baseline.suiteManifestHash !== input.suite.manifestHash) {
    throw new CoverageEstimateError("Coverage estimate baseline suiteManifestHash does not match suite.");
  }
  if (input.selectedModels.length === 0) {
    throw new CoverageEstimateError("Coverage estimate requires at least one selected model.");
  }
  if (input.generator === "agent" && input.selectedModels.some((model) =>
    model.provider === "gemini" || model.provider === "openrouter"
  )) {
    throw new CoverageEstimateError(
      "Agent generator currently supports OpenAI and Anthropic only; use the built-in generator for Gemini or OpenRouter.",
    );
  }
  if (!Number.isFinite(input.spendCapUsd) || input.spendCapUsd <= 0) {
    throw new CoverageEstimateError("Coverage estimate spend cap must be positive.");
  }

  const tokenTotals = new Map<string, number>();
  const pricingByModel = new Map<string, CoverageEstimate["pricing"][number]>();
  const usdByModel: CoverageEstimate["estimatedUsdByModel"][number][] = [];

  for (const selected of input.selectedModels) {
    let harnessUsd = 0;
    let harnessCalls = 0;
    for (const task of baselineTasksForProvider(input.suite, input.baseline, selected.provider)) {
      addTaskTokenTotals(tokenTotals, task);
      const price = lookupPrice({
        provider: selected.provider,
        model: selected.model,
        eventTime: input.eventTime,
        ...(providerPlane(selected.provider, selected.model)
          ? { plane: providerPlane(selected.provider, selected.model) }
          : {}),
        usage: normalizedUsageFromBaselineTask(task),
      });
      if (!price.ok) {
        throw new CoverageEstimateError(
          `pricing_unknown for ${selected.provider}:${selected.model} categories ${price.usageCategories.join(",")}`,
        );
      }
      if (price.pricingStatus === "partial") {
        throw new CoverageEstimateError(`partial pricing for ${selected.provider}:${selected.model}`);
      }
      harnessUsd = roundUsd(harnessUsd + price.expectedChargeUsd * task.plannedCalls);
      harnessCalls += task.plannedCalls;
      pricingByModel.set(modelKey(selected), {
        provider: selected.provider,
        model: selected.model,
        pricingVersion: price.pricingVersion,
        source: price.source,
        pricingStatus: "priced",
      });
    }
    addDriftCanaryTokenTotals(tokenTotals);
    const canaryPrice = lookupPrice({
      provider: selected.provider,
      model: selected.model,
      eventTime: input.eventTime,
      ...(providerPlane(selected.provider, selected.model)
        ? { plane: providerPlane(selected.provider, selected.model) }
        : {}),
      usage: DRIFT_CANARY_ESTIMATED_USAGE,
    });
    if (!canaryPrice.ok) {
      throw new CoverageEstimateError(
        `pricing_unknown for drift canary ${selected.provider}:${selected.model} categories ${canaryPrice.usageCategories.join(",")}`,
      );
    }
    if (canaryPrice.pricingStatus === "partial") {
      throw new CoverageEstimateError(`partial drift canary pricing for ${selected.provider}:${selected.model}`);
    }
    harnessUsd = roundUsd(harnessUsd + canaryPrice.expectedChargeUsd * DRIFT_CANARY_ITEM_COUNT);
    harnessCalls += DRIFT_CANARY_ITEM_COUNT;
    pricingByModel.set(modelKey(selected), {
      provider: selected.provider,
      model: selected.model,
      pricingVersion: canaryPrice.pricingVersion,
      source: canaryPrice.source,
      pricingStatus: "priced",
    });
    const organicBudget = input.generator === "agent"
      ? estimateAgentOrganicBudget({
          provider: selected.provider,
          model: selected.model,
          suite: input.suite,
          eventTime: input.eventTime,
        })
      : undefined;
    if (organicBudget) addAgentOrganicTokenTotals(tokenTotals, organicBudget);
    const estimatedUsdBand = organicBudget
      ? {
          low: roundUsd(harnessUsd + organicBudget.usd.low),
          expected: roundUsd(harnessUsd + organicBudget.usd.expected),
          high: roundUsd(harnessUsd + organicBudget.usd.high),
        }
      : { low: roundUsd(harnessUsd), expected: roundUsd(harnessUsd), high: roundUsd(harnessUsd) };
    const plannedCallsBand = organicBudget
      ? {
          low: harnessCalls + organicBudget.calls.low,
          expected: harnessCalls + organicBudget.calls.expected,
          high: harnessCalls + organicBudget.calls.high,
        }
      : { low: harnessCalls, expected: harnessCalls, high: harnessCalls };
    usdByModel.push({
      provider: selected.provider,
      model: selected.model,
      estimatedUsd: input.generator === "agent" ? estimatedUsdBand.high : estimatedUsdBand.expected,
      plannedCalls: input.generator === "agent" ? plannedCallsBand.high : plannedCallsBand.expected,
      estimatedUsdBand,
      plannedCallsBand,
      ...(organicBudget ? { organicBudget: organicBudget.receipt } : {}),
    });
  }

  const selectedModels = [...input.selectedModels].map((model) => ({ ...model }));
  const estimatedUsdBand = {
    low: roundUsd(usdByModel.reduce((total, model) => total + model.estimatedUsdBand.low, 0)),
    expected: roundUsd(usdByModel.reduce((total, model) => total + model.estimatedUsdBand.expected, 0)),
    high: roundUsd(usdByModel.reduce((total, model) => total + model.estimatedUsdBand.high, 0)),
  };
  const estimatedUsd = input.generator === "agent" ? estimatedUsdBand.high : estimatedUsdBand.expected;
  const baselineContentDigest = input.baseline.baselineContentDigest ??
    coverageBaselineContentDigest(input.baseline);
  return {
    estimateHash: estimateHash({
      selectedModels,
      generator: input.generator,
      suiteVersion: input.suite.suiteVersion,
      baselineVersion: input.baseline.baselineVersion,
      baselineContentDigest,
      spendCapUsd: input.spendCapUsd,
      estimatedUsd,
      estimatedUsdBand,
      estimatedUsdByModel: usdByModel,
      driftCanaryManifestHash: CHECKED_IN_DRIFT_CANARY_V1_MANIFEST_HASH,
      pricing: [...pricingByModel.values()],
    }),
    suiteVersion: input.suite.suiteVersion,
    driftCanaryManifestHash: CHECKED_IN_DRIFT_CANARY_V1_MANIFEST_HASH,
    baselineVersion: input.baseline.baselineVersion,
    baselineContentDigest,
    generator: input.generator,
    spendCapUsd: input.spendCapUsd,
    selectedModels,
    estimatedTokensByCategory: Object.fromEntries([...tokenTotals.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )),
    estimatedUsdBand,
    estimatedUsdByModel: usdByModel,
    estimatedUsd,
    pricing: [...pricingByModel.values()].sort((left, right) => modelKey(left).localeCompare(modelKey(right))),
  };
}

function estimateSingleModelUsd(input: {
  readonly provider: Provider;
  readonly model: string;
  readonly suite: LoadedCoverageSuiteManifest;
  readonly baseline: LoadedCoverageTokenBaseline;
  readonly eventTime: string;
}): number {
  let total = 0;
  for (const task of baselineTasksForProvider(input.suite, input.baseline, input.provider)) {
    const price = lookupPrice({
      provider: input.provider,
      model: input.model,
      eventTime: input.eventTime,
      ...(providerPlane(input.provider, input.model) ? { plane: providerPlane(input.provider, input.model) } : {}),
      usage: normalizedUsageFromBaselineTask(task),
    });
    if (!price.ok || price.pricingStatus === "partial") return Number.POSITIVE_INFINITY;
    total = roundUsd(total + price.expectedChargeUsd * task.plannedCalls);
  }
  const canaryPrice = lookupPrice({
    provider: input.provider,
    model: input.model,
    eventTime: input.eventTime,
    ...(providerPlane(input.provider, input.model) ? { plane: providerPlane(input.provider, input.model) } : {}),
    usage: DRIFT_CANARY_ESTIMATED_USAGE,
  });
  if (!canaryPrice.ok || canaryPrice.pricingStatus === "partial") return Number.POSITIVE_INFINITY;
  total = roundUsd(total + canaryPrice.expectedChargeUsd * DRIFT_CANARY_ITEM_COUNT);
  return total;
}

function estimateHash(input: {
  readonly selectedModels: readonly CoverageSelectedModel[];
  readonly generator: CoverageGenerator;
  readonly suiteVersion: string;
  readonly baselineVersion: string;
  readonly baselineContentDigest: string;
  readonly spendCapUsd: number;
  readonly estimatedUsd: number;
  readonly estimatedUsdBand: CoverageEstimateBand;
  readonly estimatedUsdByModel: readonly CoverageEstimate["estimatedUsdByModel"][number][];
  readonly driftCanaryManifestHash: string;
  readonly pricing: readonly CoverageEstimate["pricing"][number][];
}): string {
  return stableSha256({
    models: input.selectedModels
      .map((model) => ({ provider: model.provider, model: model.model }))
      .sort((left, right) =>
        `${left.provider}:${left.model}`.localeCompare(`${right.provider}:${right.model}`)
      ),
    generator: input.generator,
    suiteVersion: input.suiteVersion,
    baselineVersion: input.baselineVersion,
    baselineContentDigest: input.baselineContentDigest,
    driftCanaryManifestHash: input.driftCanaryManifestHash,
    cap: input.spendCapUsd,
    estimatedUsd: input.estimatedUsd,
    estimatedUsdBand: input.estimatedUsdBand,
    estimatedUsdByModel: input.estimatedUsdByModel
      .map((model) => ({ ...model }))
      .sort((left, right) =>
        `${left.provider}:${left.model}`.localeCompare(`${right.provider}:${right.model}`)
      ),
    pricing: input.pricing
      .map((pricing) => ({ ...pricing }))
      .sort((left, right) =>
        `${left.provider}:${left.model}`.localeCompare(`${right.provider}:${right.model}`)
      ),
  });
}

function baselineTasksForProvider(
  suite: LoadedCoverageSuiteManifest,
  baseline: LoadedCoverageTokenBaseline,
  provider: Provider,
): CoverageTokenBaselineTask[] {
  const suiteTasksById = new Map(suite.tasks.map((task) => [task.taskId, task]));
  return baseline.tasks.filter((task) => {
    const suiteTask = suiteTasksById.get(task.taskId);
    return Boolean(suiteTask?.providerRoutes.some((route) => route.startsWith(`${provider}:`)));
  });
}

function requiredRoutesForProvider(suite: LoadedCoverageSuiteManifest, provider: Provider): readonly string[] {
  const routes = new Set<string>();
  for (const task of suite.tasks) {
    for (const route of task.providerRoutes) {
      if (route.startsWith(`${provider}:`)) routes.add(route.slice(provider.length + 1));
    }
  }
  return [...routes];
}

function addTaskTokenTotals(
  totals: Map<string, number>,
  task: CoverageTokenBaselineTask,
): void {
  addTokens(totals, "input", task.usage.input * task.plannedCalls);
  addTokens(totals, "output", task.usage.output * task.plannedCalls);
  addTokens(totals, "cache_read", (task.usage.cacheRead ?? 0) * task.plannedCalls);
  addTokens(totals, "cache_creation", (task.usage.cacheCreation ?? 0) * task.plannedCalls);
  for (const category of task.usage.categories ?? []) {
    addTokens(totals, category.category, category.tokens * task.plannedCalls);
  }
}

function addDriftCanaryTokenTotals(totals: Map<string, number>): void {
  addTokens(totals, "input", DRIFT_CANARY_ESTIMATED_USAGE.input * DRIFT_CANARY_ITEM_COUNT);
  addTokens(totals, "output", DRIFT_CANARY_ESTIMATED_USAGE.output * DRIFT_CANARY_ITEM_COUNT);
}

function estimateAgentOrganicBudget(input: {
  readonly provider: Provider;
  readonly model: string;
  readonly suite: LoadedCoverageSuiteManifest;
  readonly eventTime: string;
}): {
  readonly usd: CoverageEstimateBand;
  readonly calls: CoverageCallBand;
  readonly receipt: CoverageOrganicBudgetEstimate;
} {
  const budget = input.suite.agentMode.organicTaskBudget;
  const price = lookupPrice({
    provider: input.provider,
    model: input.model,
    eventTime: input.eventTime,
    ...(providerPlane(input.provider, input.model) ? { plane: providerPlane(input.provider, input.model) } : {}),
    usage: {
      input: budget.estimatedUsagePerCall.input,
      output: budget.estimatedUsagePerCall.output,
      cache: {
        read: budget.estimatedUsagePerCall.cacheRead ?? 0,
        creation: budget.estimatedUsagePerCall.cacheCreation ?? 0,
      },
    },
  });
  if (!price.ok) {
    throw new CoverageEstimateError(
      `pricing_unknown for agent organic ${input.provider}:${input.model} categories ${price.usageCategories.join(",")}`,
    );
  }
  if (price.pricingStatus === "partial") {
    throw new CoverageEstimateError(`partial agent organic pricing for ${input.provider}:${input.model}`);
  }
  const calls = {
    low: budget.corpusTaskCount * budget.lowCallsPerTask,
    expected: budget.corpusTaskCount * budget.expectedCallsPerTask,
    high: budget.corpusTaskCount * budget.maxCallsPerTask,
  };
  return {
    usd: {
      low: roundUsd(price.expectedChargeUsd * calls.low),
      expected: roundUsd(price.expectedChargeUsd * calls.expected),
      high: roundUsd(price.expectedChargeUsd * calls.high),
    },
    calls,
    receipt: {
      corpusTaskCount: budget.corpusTaskCount,
      lowCallsPerTask: budget.lowCallsPerTask,
      expectedCallsPerTask: budget.expectedCallsPerTask,
      maxCallsPerTask: budget.maxCallsPerTask,
      maxWallTimeMsPerTask: budget.maxWallTimeMsPerTask,
      estimatedUsagePerCall: {
        input: budget.estimatedUsagePerCall.input,
        output: budget.estimatedUsagePerCall.output,
        ...(budget.estimatedUsagePerCall.cacheRead !== undefined
          ? { cacheRead: budget.estimatedUsagePerCall.cacheRead }
          : {}),
        ...(budget.estimatedUsagePerCall.cacheCreation !== undefined
          ? { cacheCreation: budget.estimatedUsagePerCall.cacheCreation }
          : {}),
      },
    },
  };
}

function addAgentOrganicTokenTotals(
  totals: Map<string, number>,
  organicBudget: ReturnType<typeof estimateAgentOrganicBudget>,
): void {
  const usage = organicBudget.receipt.estimatedUsagePerCall;
  addTokens(totals, "input", usage.input * organicBudget.calls.high);
  addTokens(totals, "output", usage.output * organicBudget.calls.high);
  addTokens(totals, "cache_read", (usage.cacheRead ?? 0) * organicBudget.calls.high);
  addTokens(totals, "cache_creation", (usage.cacheCreation ?? 0) * organicBudget.calls.high);
}

function addTokens(totals: Map<string, number>, category: string, tokens: number): void {
  if (tokens <= 0) return;
  totals.set(category, (totals.get(category) ?? 0) + tokens);
}

function uniqueProviders(providers: readonly Provider[]): readonly Provider[] {
  return [...new Set(providers)];
}

function modelKey(model: { readonly provider: Provider; readonly model: string }): string {
  return `${model.provider}:${model.model}`;
}

function providerPlane(provider: Provider, model?: string): string | undefined {
  if (provider === "gemini") return GEMINI_DEVELOPER_API_PLANE;
  if (provider === "openrouter") return openRouterPlaneForModel(model);
  return undefined;
}
