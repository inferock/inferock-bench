import type { ProviderName } from "../provider.js";

export type ConformanceProbeModelPolicy =
  | "pricing-registry-conformance-default"
  | "bench-serving-default-conformance";

export type ConformanceModelProvider = Extract<ProviderName, "openai" | "anthropic">;
export type HiddenTokenModelPurpose = "hidden_token_positive" | "hidden_token_negative";

const HIDDEN_TOKEN_MODEL_CANDIDATES: Readonly<
  Record<ConformanceModelProvider, Readonly<Record<HiddenTokenModelPurpose, readonly string[]>>>
> = {
  openai: {
    hidden_token_positive: [
      "gpt-5.4-mini",
      "gpt-5.4",
      "gpt-5-mini",
      "gpt-5",
    ],
    hidden_token_negative: [
      "gpt-4o-mini",
      "gpt-4o",
      "gpt-5.4-mini",
      "gpt-5.4",
    ],
  },
  anthropic: {
    hidden_token_positive: [
      "claude-sonnet-5",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-opus-4-8",
    ],
    hidden_token_negative: [
      "claude-haiku-4-5",
      "claude-sonnet-4-5",
    ],
  },
};

export function hiddenTokenServingModelCandidates(
  provider: ConformanceModelProvider,
  purpose: HiddenTokenModelPurpose,
): readonly string[] {
  return HIDDEN_TOKEN_MODEL_CANDIDATES[provider][purpose]
    .filter((model) => !isDisallowedConformanceProbeModel(provider, model));
}

export function defaultHiddenTokenServingModel(
  provider: ConformanceModelProvider,
  purpose: HiddenTokenModelPurpose,
): string {
  const selected = hiddenTokenServingModelCandidates(provider, purpose)[0];
  if (!selected) {
    throw new Error(`No hidden-token serving default candidate for ${provider}:${purpose}.`);
  }
  return selected;
}

export function isDisallowedConformanceProbeModel(
  provider: ConformanceModelProvider,
  model: string,
): boolean {
  const normalized = model.toLowerCase();
  if (normalized.includes("preview") || normalized.includes("glasswing")) return true;
  if (provider === "anthropic") {
    return normalized.includes("mythos");
  }
  return /^gpt-5\.5(?:-|$)/.test(normalized) ||
    normalized === "gpt-4o-mini-2024-07-18";
}

export function isAnthropicThinkingCapableModel(model: string): boolean {
  return /^claude-(?:opus|sonnet|fable)-[45](?:-|$)/.test(model);
}
