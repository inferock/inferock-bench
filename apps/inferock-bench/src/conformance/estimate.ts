import {
  listPricedModelOptions,
  lookupPrice,
  roundUsd,
  type PriceLookupResult,
  type PricedModelOption,
} from "@inferock/measure/pricing";
import type { ProviderName } from "../provider.js";
import { stableSha256 } from "../coverage-suite/canonical-json.js";
import type { ConformanceModule } from "./types.js";
import {
  defaultHiddenTokenServingModel,
  isAnthropicThinkingCapableModel,
  type ConformanceProbeModelPolicy,
} from "./model-selection.js";

export const DEFAULT_CONFORMANCE_SPEND_CAP_USD = 1;
export const CONFORMANCE_ESTIMATE_SCHEMA_VERSION = "inferock-real-provider-conformance-estimate-v1";

type ConformanceProvider = Extract<ProviderName, "openai" | "anthropic">;

export interface ConformanceSelectedModel {
  readonly provider: ConformanceProvider;
  readonly model: string;
  readonly purpose: "stream" | "hidden_token_positive" | "hidden_token_negative";
  readonly presetPolicy: ConformanceProbeModelPolicy;
}

export interface ConformanceEstimateInput {
  readonly modules: readonly ConformanceModule[];
  readonly providers: readonly ConformanceProvider[];
  readonly spendCapUsd?: number;
  readonly eventTime: string;
  readonly allowPricingUnknownForValidation?: boolean;
}

export interface ConformanceEstimate {
  readonly schemaVersion: typeof CONFORMANCE_ESTIMATE_SCHEMA_VERSION;
  readonly estimateHash: string;
  readonly generatedAt: string;
  readonly modules: readonly ConformanceModule[];
  readonly providers: readonly ConformanceProvider[];
  readonly selectedModels: readonly ConformanceSelectedModel[];
  readonly plannedCallCount: number;
  readonly maxOutputTokens: number;
  readonly maxThinkingTokens: number;
  readonly moduleBudgetsUsd: Readonly<Record<ConformanceModule, number>>;
  readonly estimatedUsdUpperBound: number;
  readonly spendCapUsd: number;
  readonly pricing: readonly ConformanceEstimatePricing[];
}

export type ConformanceEstimatePricing =
  | {
      readonly provider: ConformanceProvider;
      readonly model: string;
      readonly pricingVersion: string;
      readonly source: string;
      readonly pricingStatus: "priced";
    }
  | {
      readonly provider: ConformanceProvider;
      readonly model: string;
      readonly pricingStatus: "pricing_unknown" | "partial";
      readonly usageCategories: readonly string[];
    };

export class ConformanceEstimateError extends Error {}

export function buildConformanceEstimate(input: ConformanceEstimateInput): ConformanceEstimate {
  const spendCapUsd = input.spendCapUsd ?? DEFAULT_CONFORMANCE_SPEND_CAP_USD;
  if (!Number.isFinite(spendCapUsd) || spendCapUsd <= 0) {
    throw new ConformanceEstimateError("--spend-cap-usd must be a positive number.");
  }
  const modules = [...new Set(input.modules)].sort();
  const providers = [...new Set(input.providers)].sort();
  if (modules.length === 0) throw new ConformanceEstimateError("Conformance estimate requires at least one module.");
  if (providers.length === 0) throw new ConformanceEstimateError("Conformance estimate requires at least one provider.");

  const selectedModels = selectedModelsForConformance({ modules, providers, eventTime: input.eventTime });
  const pricing = selectedModels.map((model) => estimatePricingForModel(model, input.eventTime));
  const blockingPricing = pricing.find((entry) => entry.pricingStatus !== "priced");
  if (blockingPricing && !input.allowPricingUnknownForValidation) {
    throw new ConformanceEstimateError(
      `pricing_unknown for conformance model ${blockingPricing.provider}:${blockingPricing.model}; pass --allow-pricing-unknown-for-validation to record explicit pricing_unknown validation status.`,
    );
  }

  const moduleBudgetsUsd = moduleBudgets(modules);
  const estimatedUsdUpperBound = roundUsd(Object.values(moduleBudgetsUsd)
    .reduce((total, value) => total + value, 0));
  const estimateWithoutHash = {
    schemaVersion: CONFORMANCE_ESTIMATE_SCHEMA_VERSION as typeof CONFORMANCE_ESTIMATE_SCHEMA_VERSION,
    generatedAt: input.eventTime,
    modules,
    providers,
    selectedModels,
    plannedCallCount: plannedCallCount(modules, providers),
    maxOutputTokens: modules.includes("hidden_token") ? 1024 : 512,
    maxThinkingTokens: modules.includes("hidden_token") ? 1024 : 0,
    moduleBudgetsUsd,
    estimatedUsdUpperBound,
    spendCapUsd,
    pricing,
  };
  const hashInput = {
    schemaVersion: estimateWithoutHash.schemaVersion,
    modules,
    providers,
    selectedModels,
    plannedCallCount: estimateWithoutHash.plannedCallCount,
    maxOutputTokens: estimateWithoutHash.maxOutputTokens,
    maxThinkingTokens: estimateWithoutHash.maxThinkingTokens,
    moduleBudgetsUsd,
    estimatedUsdUpperBound,
    spendCapUsd,
    pricing,
  };
  return {
    ...estimateWithoutHash,
    estimateHash: stableSha256(hashInput),
  };
}

export function renderConformanceEstimate(estimate: ConformanceEstimate): string {
  return [
    "inferock-bench real-provider conformance estimate (experimental)",
    `modules: ${estimate.modules.join(", ")}`,
    `providers: ${estimate.providers.join(", ")}`,
    `selected model(s): ${estimate.selectedModels.map((model) => `${model.provider}:${model.model}:${model.purpose}`).join(", ")}`,
    `planned calls: ${estimate.plannedCallCount}`,
    `max output tokens: ${estimate.maxOutputTokens}`,
    `max thinking tokens: ${estimate.maxThinkingTokens}`,
    `module budgets: ${Object.entries(estimate.moduleBudgetsUsd).map(([module, usd]) => `${module}=$${usd.toFixed(2)}`).join(", ")}`,
    `estimated USD upper bound: ${formatUsd(estimate.estimatedUsdUpperBound)}`,
    `spend cap: ${formatUsd(estimate.spendCapUsd)}`,
    `pricing sources: ${estimate.pricing.map(renderPricingLine).join("; ")}`,
    "BYOK validation: real provider runs require disposable EC2 validation keys and explicit estimate acceptance. Fixture-only replay makes zero provider calls.",
    `estimate hash: ${estimate.estimateHash}`,
  ].join("\n");
}

function selectedModelsForConformance(input: {
  readonly modules: readonly ConformanceModule[];
  readonly providers: readonly ConformanceProvider[];
  readonly eventTime: string;
}): readonly ConformanceSelectedModel[] {
  const selected: ConformanceSelectedModel[] = [];
  for (const provider of input.providers) {
    if (input.modules.includes("stream_sse")) {
      selected.push({
        provider,
        model: defaultStreamModel(provider, input.eventTime),
        purpose: "stream",
        presetPolicy: "pricing-registry-conformance-default",
      });
    }
    if (input.modules.includes("hidden_token")) {
      selected.push({
        provider,
        model: defaultHiddenPositiveModel(provider),
        purpose: "hidden_token_positive",
        presetPolicy: "bench-serving-default-conformance",
      });
      selected.push({
        provider,
        model: defaultHiddenNegativeModel(provider),
        purpose: "hidden_token_negative",
        presetPolicy: "bench-serving-default-conformance",
      });
    }
  }
  return uniqueModels(selected);
}

function defaultStreamModel(provider: ConformanceProvider, eventTime: string): string {
  return cheapestRoutedModel(provider, eventTime).model;
}

function defaultHiddenPositiveModel(provider: ConformanceProvider): string {
  const selected = defaultHiddenTokenServingModel(provider, "hidden_token_positive");
  if (provider === "anthropic" && !isAnthropicThinkingCapableModel(selected)) {
    throw new ConformanceEstimateError(`Hidden-token Anthropic positive default is not thinking-capable: ${selected}.`);
  }
  return selected;
}

function defaultHiddenNegativeModel(provider: ConformanceProvider): string {
  return defaultHiddenTokenServingModel(provider, "hidden_token_negative");
}

function cheapestRoutedModel(provider: ConformanceProvider, eventTime: string): PricedModelOption {
  const options = pricedOptions(provider, eventTime);
  let cheapest: { readonly option: PricedModelOption; readonly usd: number } | undefined;
  for (const option of options) {
    const price = lookupPrice({
      provider,
      model: option.model,
      eventTime,
      usage: estimatedUsageForProvider(provider),
    });
    if (!price.ok || price.pricingStatus !== "priced") continue;
    if (!cheapest || price.expectedChargeUsd < cheapest.usd) {
      cheapest = { option, usd: price.expectedChargeUsd };
    }
  }
  if (!cheapest) throw new ConformanceEstimateError(`No priced conformance model available for ${provider}.`);
  return cheapest.option;
}

function pricedOptions(provider: ConformanceProvider, eventTime: string): readonly PricedModelOption[] {
  return listPricedModelOptions({ provider, eventTime })
    .filter((option) => provider === "openai"
      ? option.routeCapabilities.includes("chat.completions") || option.routeCapabilities.includes("responses")
      : option.routeCapabilities.includes("messages"));
}

function estimatePricingForModel(
  model: ConformanceSelectedModel,
  eventTime: string,
): ConformanceEstimatePricing {
  const price: PriceLookupResult = lookupPrice({
    provider: model.provider,
    model: model.model,
    eventTime,
    usage: estimatedUsageForProvider(model.provider),
  });
  if (!price.ok) {
    return {
      provider: model.provider,
      model: model.model,
      pricingStatus: "pricing_unknown",
      usageCategories: price.usageCategories,
    };
  }
  if (price.pricingStatus !== "priced") {
    return {
      provider: model.provider,
      model: model.model,
      pricingStatus: "partial",
      usageCategories: price.components
        .filter((component) => component.pricingStatus === "unpriced")
        .map((component) => component.category),
    };
  }
  return {
    provider: model.provider,
    model: model.model,
    pricingVersion: price.pricingVersion,
    source: price.source,
    pricingStatus: "priced",
  };
}

function estimatedUsageForProvider(provider: ConformanceProvider) {
  if (provider === "anthropic") {
    return {
      input: 900,
      output: 384,
      cache: { read: 0, creation: 0 },
      categories: [
        { category: "input", tokens: 900, provider },
        { category: "output", tokens: 384, provider },
      ],
    };
  }
  return {
    input: 900,
    output: 384,
    cache: { read: 0, creation: 0 },
    categories: [
      { category: "input", tokens: 900, provider },
      { category: "output", tokens: 384, provider },
    ],
  };
}

function plannedCallCount(
  modules: readonly ConformanceModule[],
  providers: readonly ConformanceProvider[],
): number {
  let count = 0;
  if (modules.includes("stream_sse")) {
    if (providers.includes("openai")) count += 2;
    if (providers.includes("anthropic")) count += 1;
  }
  if (modules.includes("hidden_token")) {
    if (providers.includes("openai")) count += 3;
    if (providers.includes("anthropic")) count += 2;
  }
  return count;
}

function moduleBudgets(modules: readonly ConformanceModule[]): Readonly<Record<ConformanceModule, number>> {
  return {
    stream_sse: modules.includes("stream_sse") ? 0.25 : 0,
    hidden_token: modules.includes("hidden_token") ? 0.75 : 0,
  };
}

function uniqueModels(models: readonly ConformanceSelectedModel[]): readonly ConformanceSelectedModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    const key = `${model.provider}:${model.model}:${model.purpose}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderPricingLine(entry: ConformanceEstimatePricing): string {
  if (entry.pricingStatus === "priced") {
    return `${entry.provider}:${entry.model} ${entry.pricingVersion} ${entry.source}`;
  }
  return `${entry.provider}:${entry.model} ${entry.pricingStatus} categories=${entry.usageCategories.join(",")}`;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
