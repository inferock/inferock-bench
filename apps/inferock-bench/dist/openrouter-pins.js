import { OPENROUTER_PLANE } from "@inferock/measure/pricing";
import { asRecord, isRecord, stringValue, } from "./record.js";
export class OpenRouterPinningError extends Error {
    code = "openrouter_endpoint_pin_required";
}
export const OPENROUTER_PINNED_ENDPOINTS = [
    pinnedEndpoint("meta-llama/llama-4-maverick", "parasail/fp8", "fp8"),
    pinnedEndpoint("deepseek/deepseek-v4-pro", "deepseek"),
    pinnedEndpoint("deepseek/deepseek-v3.2", "deepinfra/fp4", "fp4"),
    pinnedEndpoint("qwen/qwen3-235b-a22b-2507", "deepinfra/fp8", "fp8"),
    pinnedEndpoint("mistralai/mistral-large-2512", "mistral"),
    pinnedEndpoint("moonshotai/kimi-k2.7-code", "moonshotai/int4", "int4"),
    pinnedEndpoint("z-ai/glm-5.2", "z-ai/fp8", "fp8"),
];
export function openRouterPinnedEndpointForModel(model) {
    const normalized = model?.trim();
    if (!normalized)
        return undefined;
    return OPENROUTER_PINNED_ENDPOINTS.find((endpoint) => endpoint.model === normalized);
}
export function openRouterPlaneForModel(model) {
    return openRouterPinnedEndpointForModel(model)?.plane;
}
export function openRouterPinnedRequestBody(body) {
    if (Object.prototype.hasOwnProperty.call(body, "provider")) {
        throw new OpenRouterPinningError("OpenRouter provider routing is owned by inferock-bench; remove body.provider so the pinned endpoint can be enforced.");
    }
    const model = stringValue(body.model);
    const pinned = openRouterPinnedEndpointForModel(model);
    if (!pinned) {
        throw new OpenRouterPinningError(`OpenRouter model ${model ?? "unknown_model"} is not in the pinned 0.1.8 endpoint set.`);
    }
    return {
        ...body,
        provider: {
            order: [pinned.providerSlug],
            only: [pinned.providerSlug],
            allow_fallbacks: false,
            require_parameters: true,
            ...(pinned.quantization ? { quantizations: [pinned.quantization] } : {}),
        },
    };
}
export function isOpenRouterPinningError(error) {
    return error instanceof OpenRouterPinningError;
}
export function openRouterPinnedGenerationEvidence(body) {
    const provider = asRecord(body.provider);
    if (!provider)
        return undefined;
    const order = stringArray(provider.order);
    const only = stringArray(provider.only);
    const quantizations = stringArray(provider.quantizations);
    const pinned = order[0] ?? only[0];
    if (!pinned)
        return undefined;
    return {
        openRouterPinnedUpstream: pinned,
        openRouterProviderOrder: order,
        openRouterOnlyProviders: only,
        openRouterFallbacksAllowed: provider.allow_fallbacks !== false,
        openRouterRequireParameters: provider.require_parameters === true,
        ...(quantizations.length > 0 ? { openRouterQuantizations: quantizations } : {}),
    };
}
function pinnedEndpoint(model, providerSlug, quantization) {
    return {
        model,
        providerSlug,
        ...(quantization ? { quantization } : {}),
        plane: `${OPENROUTER_PLANE}:${providerSlug}`,
    };
}
function stringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((entry) => typeof entry === "string" && entry.trim().length > 0);
}
export function openRouterProviderSelectionMatchesPinned(body) {
    const pinned = openRouterPinnedEndpointForModel(stringValue(body.model));
    const provider = isRecord(body.provider) ? body.provider : undefined;
    if (!pinned || !provider)
        return false;
    const order = stringArray(provider.order);
    const only = stringArray(provider.only);
    const quantizations = stringArray(provider.quantizations);
    return order.length === 1 &&
        order[0] === pinned.providerSlug &&
        only.length === 1 &&
        only[0] === pinned.providerSlug &&
        provider.allow_fallbacks === false &&
        provider.require_parameters === true &&
        (!pinned.quantization || (quantizations.length === 1 && quantizations[0] === pinned.quantization));
}
//# sourceMappingURL=openrouter-pins.js.map