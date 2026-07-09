const HIDDEN_OUTPUT_CANONICAL_CATEGORY_NAMES = [
  "reasoning",
  "thinking",
  "hidden_output",
  "output_hidden",
  "completion_reasoning",
  "gemini_thinking",
] as const;

const HIDDEN_OUTPUT_PROVIDER_CATEGORY_NAMES = [
  "completion_tokens_details.reasoning_tokens",
  "completion_tokens_details.rejected_prediction_tokens",
  "output_tokens_details.reasoning_tokens",
  "output_tokens_details.thinking_tokens",
  "output_tokens_details.rejected_prediction_tokens",
  "provider:openai:completion_tokens_details.reasoning_tokens",
  "provider:openai:completion_tokens_details.rejected_prediction_tokens",
  "provider:openai:output_tokens_details.reasoning_tokens",
  "provider:openai:output_tokens_details.rejected_prediction_tokens",
  "provider:anthropic:output_tokens_details.thinking_tokens",
  "provider:gemini:thoughtsTokenCount",
] as const;

const hiddenOutputCanonicalCategories = new Set<string>(
  HIDDEN_OUTPUT_CANONICAL_CATEGORY_NAMES,
);
const hiddenOutputProviderCategories = new Set<string>(
  HIDDEN_OUTPUT_PROVIDER_CATEGORY_NAMES,
);

export function isCanonicalHiddenOutputCategory(category: string): boolean {
  return hiddenOutputCanonicalCategories.has(category);
}

export function isProviderHiddenOutputCategory(category: string): boolean {
  return hiddenOutputProviderCategories.has(category);
}

export function isHiddenOutputUsageCategory(category: string): boolean {
  return isCanonicalHiddenOutputCategory(category) ||
    isProviderHiddenOutputCategory(category);
}
