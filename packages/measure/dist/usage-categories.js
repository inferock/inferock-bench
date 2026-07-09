const HIDDEN_OUTPUT_CANONICAL_CATEGORY_NAMES = [
    "reasoning",
    "thinking",
    "hidden_output",
    "output_hidden",
    "completion_reasoning",
    "gemini_thinking",
];
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
];
const hiddenOutputCanonicalCategories = new Set(HIDDEN_OUTPUT_CANONICAL_CATEGORY_NAMES);
const hiddenOutputProviderCategories = new Set(HIDDEN_OUTPUT_PROVIDER_CATEGORY_NAMES);
export function isCanonicalHiddenOutputCategory(category) {
    return hiddenOutputCanonicalCategories.has(category);
}
export function isProviderHiddenOutputCategory(category) {
    return hiddenOutputProviderCategories.has(category);
}
export function isHiddenOutputUsageCategory(category) {
    return isCanonicalHiddenOutputCategory(category) ||
        isProviderHiddenOutputCategory(category);
}
//# sourceMappingURL=usage-categories.js.map