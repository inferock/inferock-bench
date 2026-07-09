import { isHiddenOutputUsageCategory } from "./usage-categories.js";
const DEFAULT_CACHE_READ_MULTIPLIER = 0.1;
const USD_PRECISION = 1_000_000;
const DEFAULT_EFFECTIVE_FROM = "2024-01-01T00:00:00.000Z";
const DEFAULT_PRICING_VERSION = "pricing-registry-v0";
const PRICING_SOURCE_RETRIEVED_AT = "2026-07-05";
const OPENAI_GPT_4O_MINI_PRICING_SOURCE = "https://developers.openai.com/api/docs/models/gpt-4o-mini";
const OPENAI_GPT_4O_PRICING_SOURCE = "https://developers.openai.com/api/docs/models/gpt-4o";
const OPENAI_FLAGSHIP_PRICING_SOURCE = "https://developers.openai.com/api/docs/pricing";
const OPENAI_TEXT_EMBEDDING_3_SMALL_PRICING_SOURCE = "https://developers.openai.com/api/docs/models/text-embedding-3-small";
const ANTHROPIC_PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
const GEMINI_PRICING_SOURCE = "https://ai.google.dev/gemini-api/docs/pricing";
const GEMINI_PRICING_SOURCE_RETRIEVED_AT = "2026-07-06";
export const GEMINI_DEVELOPER_API_PLANE = "gemini_developer_api";
const OSS_FRONTIER_PRICING_SOURCE_RETRIEVED_AT = "2026-07-06";
const MISTRAL_LARGE_3_PRICING_SOURCE = "https://docs.mistral.ai/models/model-cards/mistral-large-3-25-12";
const DEEPSEEK_PRICING_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing";
const DEEPINFRA_PRICING_SOURCE = "https://deepinfra.com/pricing";
const ALIBABA_MODEL_STUDIO_PRICING_SOURCE = "https://www.alibabacloud.com/help/en/model-studio/model-pricing";
const KIMI_PRICING_SOURCE = "https://platform.kimi.ai/docs/pricing/chat-k27-code";
const ZAI_PRICING_SOURCE = "https://docs.z.ai/guides/overview/pricing";
const OPENROUTER_PRICING_SOURCE_RETRIEVED_AT = "2026-07-06";
export const OPENROUTER_PLANE = "openrouter_openai_compatible";
const OPENROUTER_LLAMA_4_MAVERICK_ENDPOINTS_SOURCE = "https://openrouter.ai/api/v1/models/meta-llama/llama-4-maverick/endpoints";
const OPENROUTER_DEEPSEEK_V4_PRO_ENDPOINTS_SOURCE = "https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-pro/endpoints";
const OPENROUTER_DEEPSEEK_V3_2_ENDPOINTS_SOURCE = "https://openrouter.ai/api/v1/models/deepseek/deepseek-v3.2/endpoints";
const OPENROUTER_QWEN3_235B_ENDPOINTS_SOURCE = "https://openrouter.ai/api/v1/models/qwen/qwen3-235b-a22b-2507/endpoints";
const OPENROUTER_MISTRAL_LARGE_2512_ENDPOINTS_SOURCE = "https://openrouter.ai/api/v1/models/mistralai/mistral-large-2512/endpoints";
const OPENROUTER_KIMI_K2_7_CODE_ENDPOINTS_SOURCE = "https://openrouter.ai/api/v1/models/moonshotai/kimi-k2.7-code/endpoints";
const OPENROUTER_GLM_5_2_ENDPOINTS_SOURCE = "https://openrouter.ai/api/v1/models/z-ai/glm-5.2/endpoints";
const modelPricing = [];
const DEFAULT_MODEL_PRICING = [
    {
        provider: "openai",
        model: "gpt-4o-mini",
        inputUsdPerMillion: 0.15,
        outputUsdPerMillion: 0.60,
        cacheReadInputMultiplier: 0.5,
        reasoningUsdPerMillion: 0.60,
        toolUsdPerMillion: 0.60,
        effectiveFrom: "2024-07-18T00:00:00.000Z",
        source: OPENAI_GPT_4O_MINI_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "openai",
        model: "gpt-4o-mini-2024-07-18",
        inputUsdPerMillion: 0.15,
        outputUsdPerMillion: 0.60,
        cacheReadInputMultiplier: 0.5,
        reasoningUsdPerMillion: 0.60,
        toolUsdPerMillion: 0.60,
        effectiveFrom: "2024-07-18T00:00:00.000Z",
        source: OPENAI_GPT_4O_MINI_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "openai",
        model: "gpt-4o",
        inputUsdPerMillion: 2.50,
        outputUsdPerMillion: 10,
        cacheReadInputMultiplier: 0.5,
        reasoningUsdPerMillion: 10,
        toolUsdPerMillion: 10,
        effectiveFrom: "2024-05-13T00:00:00.000Z",
        source: OPENAI_GPT_4O_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "openai",
        model: "text-embedding-3-small",
        inputUsdPerMillion: 0.02,
        outputUsdPerMillion: 0,
        cacheReadInputMultiplier: null,
        effectiveFrom: "2024-01-25T00:00:00.000Z",
        source: OPENAI_TEXT_EMBEDDING_3_SMALL_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    // Standard short-context rows only. Flex, priority, and batch variants require
    // dimensions this registry does not model in the pricing lookup input.
    // gpt-5, gpt-5-mini, and gpt-5-nano stay absent until official public prices exist.
    {
        provider: "openai",
        model: "gpt-5.4",
        inputUsdPerMillion: 2.50,
        outputUsdPerMillion: 15,
        cacheReadInputMultiplier: 0.1,
        reasoningUsdPerMillion: 15,
        toolUsdPerMillion: 15,
        source: OPENAI_FLAGSHIP_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "openai",
        model: "gpt-5.4-mini",
        inputUsdPerMillion: 0.75,
        outputUsdPerMillion: 4.50,
        cacheReadInputMultiplier: 0.1,
        reasoningUsdPerMillion: 4.50,
        toolUsdPerMillion: 4.50,
        source: OPENAI_FLAGSHIP_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "openai",
        model: "gpt-5.4-nano",
        inputUsdPerMillion: 0.20,
        outputUsdPerMillion: 1.25,
        cacheReadInputMultiplier: 0.1,
        reasoningUsdPerMillion: 1.25,
        toolUsdPerMillion: 1.25,
        source: OPENAI_FLAGSHIP_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "openai",
        model: "gpt-5.4-pro",
        inputUsdPerMillion: 30,
        outputUsdPerMillion: 180,
        cacheReadInputMultiplier: null,
        reasoningUsdPerMillion: 180,
        toolUsdPerMillion: 180,
        source: OPENAI_FLAGSHIP_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "openai",
        model: "gpt-5.5",
        inputUsdPerMillion: 5,
        outputUsdPerMillion: 30,
        cacheReadInputMultiplier: 0.1,
        reasoningUsdPerMillion: 30,
        toolUsdPerMillion: 30,
        source: OPENAI_FLAGSHIP_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "openai",
        model: "gpt-5.5-pro",
        inputUsdPerMillion: 30,
        outputUsdPerMillion: 180,
        cacheReadInputMultiplier: null,
        reasoningUsdPerMillion: 180,
        toolUsdPerMillion: 180,
        source: OPENAI_FLAGSHIP_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    // Standard tier rows only. Opus 4.8 fast tier and batch rows are intentionally
    // excluded because lookup cannot discriminate those dimensions today.
    // claude-mythos-preview stays absent until an official public price exists.
    {
        provider: "anthropic",
        modelPattern: /^claude-opus-4-8(?:-\d{8})?$/,
        inputUsdPerMillion: 5,
        outputUsdPerMillion: 25,
        cacheReadInputMultiplier: 0.1,
        cacheCreationInputMultiplier: 1.25,
        anthropicCacheCreationOneHourInputMultiplier: 2,
        toolUsdPerMillion: 25,
        source: ANTHROPIC_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "anthropic",
        modelPattern: /^claude-sonnet-5(?:-\d{8})?$/,
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 10,
        cacheReadInputMultiplier: 0.1,
        cacheCreationInputMultiplier: 1.25,
        anthropicCacheCreationOneHourInputMultiplier: 2,
        toolUsdPerMillion: 10,
        effectiveTo: "2026-09-01T00:00:00.000Z",
        // Sonnet 5 publishes $2/$10 through 2026-08-31, then $3/$15 from 2026-09-01.
        source: ANTHROPIC_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "anthropic",
        modelPattern: /^claude-sonnet-5(?:-\d{8})?$/,
        inputUsdPerMillion: 3,
        outputUsdPerMillion: 15,
        cacheReadInputMultiplier: 0.1,
        cacheCreationInputMultiplier: 1.25,
        anthropicCacheCreationOneHourInputMultiplier: 2,
        toolUsdPerMillion: 15,
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        // Sonnet 5 publishes $2/$10 through 2026-08-31, then $3/$15 from 2026-09-01.
        source: ANTHROPIC_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "anthropic",
        modelPattern: /^claude-sonnet-4-6(?:-\d{8})?$/,
        inputUsdPerMillion: 3,
        outputUsdPerMillion: 15,
        cacheReadInputMultiplier: 0.1,
        cacheCreationInputMultiplier: 1.25,
        anthropicCacheCreationOneHourInputMultiplier: 2,
        toolUsdPerMillion: 15,
        source: ANTHROPIC_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "anthropic",
        modelPattern: /^claude-sonnet-4-5(?:-\d{8})?$/,
        inputUsdPerMillion: 3,
        outputUsdPerMillion: 15,
        cacheReadInputMultiplier: 0.1,
        cacheCreationInputMultiplier: 1.25,
        anthropicCacheCreationOneHourInputMultiplier: 2,
        toolUsdPerMillion: 15,
        source: ANTHROPIC_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "anthropic",
        modelPattern: /^claude-haiku-4-5(?:-\d{8})?$/,
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 5,
        cacheReadInputMultiplier: 0.1,
        cacheCreationInputMultiplier: 1.25,
        anthropicCacheCreationOneHourInputMultiplier: 2,
        toolUsdPerMillion: 5,
        effectiveFrom: "2025-10-01T00:00:00.000Z",
        source: ANTHROPIC_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "anthropic",
        modelPattern: /^claude-fable-5(?:-\d{8})?$/,
        inputUsdPerMillion: 10,
        outputUsdPerMillion: 50,
        cacheReadInputMultiplier: 0.1,
        cacheCreationInputMultiplier: 1.25,
        anthropicCacheCreationOneHourInputMultiplier: 2,
        toolUsdPerMillion: 50,
        source: ANTHROPIC_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "anthropic",
        modelPattern: /^claude-mythos-5(?:-\d{8})?$/,
        inputUsdPerMillion: 10,
        outputUsdPerMillion: 50,
        cacheReadInputMultiplier: 0.1,
        cacheCreationInputMultiplier: 1.25,
        anthropicCacheCreationOneHourInputMultiplier: 2,
        toolUsdPerMillion: 50,
        source: ANTHROPIC_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    {
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
        inputUsdPerMillion: 3,
        outputUsdPerMillion: 15,
        cacheReadInputMultiplier: 0.1,
        cacheCreationInputMultiplier: 1.25,
        anthropicCacheCreationOneHourInputMultiplier: 2,
        toolUsdPerMillion: 15,
        effectiveFrom: "2024-06-20T00:00:00.000Z",
        source: ANTHROPIC_PRICING_SOURCE,
        sourceRetrievedAt: PRICING_SOURCE_RETRIEVED_AT,
    },
    ...geminiDeveloperApiPricingRows(),
    ...ossFrontierPricingRows(),
    ...openRouterEndpointPricingRows(),
];
function geminiDeveloperApiPricingRows() {
    // Constraint: Gemini cache-storage prices are token-hour rates and are not dollarized by per-request token pricing.
    const rows = [
        geminiRow({ model: "gemini-3.5-flash", serviceTiers: ["standard"], input: 1.50, output: 9.00, cacheRead: 0.15 }),
        geminiRow({ model: "gemini-3.5-flash", serviceTiers: ["batch"], input: 0.75, output: 4.50, cacheRead: 0.075 }),
        geminiRow({ model: "gemini-3.5-flash", serviceTiers: ["flex"], input: 0.75, output: 4.50, cacheRead: 0.08 }),
        geminiRow({ model: "gemini-3.5-flash", serviceTiers: ["priority"], input: 2.70, output: 16.20, cacheRead: 0.27 }),
        geminiRow({ model: "gemini-3.1-flash-lite", serviceTiers: ["standard"], input: 0.25, audioInput: 0.50, output: 1.50, cacheRead: 0.025, audioCacheRead: 0.05 }),
        geminiRow({ model: "gemini-3.1-flash-lite", serviceTiers: ["batch", "flex"], input: 0.125, audioInput: 0.25, output: 0.75, cacheRead: 0.0125, audioCacheRead: 0.025 }),
        geminiRow({ model: "gemini-3.1-flash-lite", serviceTiers: ["priority"], input: 0.45, audioInput: 0.90, output: 2.70, cacheRead: 0.045, audioCacheRead: 0.09 }),
        ...geminiPromptThresholdRows({
            models: ["gemini-3.1-pro-preview", "gemini-3.1-pro-preview-customtools"],
            standard: { inputLow: 2.00, inputHigh: 4.00, outputLow: 12.00, outputHigh: 18.00, cacheLow: 0.20, cacheHigh: 0.40 },
            batchFlex: { inputLow: 1.00, inputHigh: 2.00, outputLow: 6.00, outputHigh: 9.00, cacheLow: 0.20, cacheHigh: 0.40 },
            priority: { inputLow: 3.60, inputHigh: 7.20, outputLow: 21.60, outputHigh: 32.40, cacheLow: 0.36, cacheHigh: 0.72 },
        }),
        geminiRow({ model: "gemini-3-flash-preview", serviceTiers: ["standard"], input: 0.50, audioInput: 1.00, output: 3.00, cacheRead: 0.05, audioCacheRead: 0.10 }),
        geminiRow({ model: "gemini-3-flash-preview", serviceTiers: ["batch", "flex"], input: 0.25, audioInput: 0.50, output: 1.50, cacheRead: 0.05, audioCacheRead: 0.10 }),
        geminiRow({ model: "gemini-3-flash-preview", serviceTiers: ["priority"], input: 0.90, audioInput: 1.80, output: 5.40, cacheRead: 0.09, audioCacheRead: 0.18 }),
        ...geminiPromptThresholdRows({
            models: ["gemini-2.5-pro"],
            standard: { inputLow: 1.25, inputHigh: 2.50, outputLow: 10.00, outputHigh: 15.00, cacheLow: 0.125, cacheHigh: 0.25 },
            batchFlex: { inputLow: 0.625, inputHigh: 1.25, outputLow: 5.00, outputHigh: 7.50, cacheLow: 0.125, cacheHigh: 0.25 },
            priority: { inputLow: 2.25, inputHigh: 4.50, outputLow: 18.00, outputHigh: 27.00, cacheLow: 0.225, cacheHigh: 0.45 },
        }),
        geminiRow({ model: "gemini-2.5-flash", serviceTiers: ["standard"], input: 0.30, audioInput: 1.00, output: 2.50, cacheRead: 0.03, audioCacheRead: 0.10 }),
        geminiRow({ model: "gemini-2.5-flash", serviceTiers: ["batch", "flex"], input: 0.15, audioInput: 0.50, output: 1.25, cacheRead: 0.03, audioCacheRead: 0.10 }),
        geminiRow({ model: "gemini-2.5-flash", serviceTiers: ["priority"], input: 0.54, audioInput: 1.80, output: 4.50, cacheRead: 0.054, audioCacheRead: 0.18 }),
        geminiRow({ model: "gemini-2.5-flash-lite", serviceTiers: ["standard"], input: 0.10, audioInput: 0.30, output: 0.40, cacheRead: 0.01, audioCacheRead: 0.03 }),
        geminiRow({ model: "gemini-2.5-flash-lite", serviceTiers: ["batch", "flex"], input: 0.05, audioInput: 0.15, output: 0.20, cacheRead: 0.01, audioCacheRead: 0.03 }),
        geminiRow({ model: "gemini-2.5-flash-lite", serviceTiers: ["priority"], input: 0.18, audioInput: 0.54, output: 0.72, cacheRead: 0.018, audioCacheRead: 0.054 }),
    ];
    return rows;
}
function geminiPromptThresholdRows(input) {
    return input.models.flatMap((model) => [
        ...geminiThresholdPair(model, ["standard"], input.standard),
        ...geminiThresholdPair(model, ["batch", "flex"], input.batchFlex),
        ...geminiThresholdPair(model, ["priority"], input.priority),
    ]);
}
function geminiThresholdPair(model, serviceTiers, rates) {
    return [
        geminiRow({
            model,
            serviceTiers,
            input: rates.inputLow,
            output: rates.outputLow,
            cacheRead: rates.cacheLow,
            promptTokenMaxInclusive: 200_000,
        }),
        geminiRow({
            model,
            serviceTiers,
            input: rates.inputHigh,
            output: rates.outputHigh,
            cacheRead: rates.cacheHigh,
            promptTokenMinExclusive: 200_000,
        }),
    ];
}
function geminiRow(input) {
    return {
        provider: "gemini",
        model: input.model,
        inputUsdPerMillion: input.input,
        outputUsdPerMillion: input.output,
        cacheReadInputMultiplier: input.cacheRead / input.input,
        audioInputUsdPerMillion: input.audioInput,
        audioCacheReadUsdPerMillion: input.audioCacheRead,
        serviceTiers: input.serviceTiers,
        promptTokenMinExclusive: input.promptTokenMinExclusive,
        promptTokenMaxInclusive: input.promptTokenMaxInclusive,
        plane: GEMINI_DEVELOPER_API_PLANE,
        source: GEMINI_PRICING_SOURCE,
        sourceRetrievedAt: GEMINI_PRICING_SOURCE_RETRIEVED_AT,
    };
}
function ossFrontierPricingRows() {
    return [
        {
            provider: "mistral",
            model: "mistral-large-2512",
            inputUsdPerMillion: 0.50,
            outputUsdPerMillion: 1.50,
            cacheReadInputMultiplier: null,
            source: MISTRAL_LARGE_3_PRICING_SOURCE,
            sourceRetrievedAt: OSS_FRONTIER_PRICING_SOURCE_RETRIEVED_AT,
        },
        {
            provider: "deepseek_platform",
            model: "deepseek-v4-pro",
            inputUsdPerMillion: 0.435,
            outputUsdPerMillion: 0.87,
            cacheReadInputMultiplier: 0.003625 / 0.435,
            source: DEEPSEEK_PRICING_SOURCE,
            sourceRetrievedAt: OSS_FRONTIER_PRICING_SOURCE_RETRIEVED_AT,
        },
        {
            provider: "deepinfra",
            model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
            inputUsdPerMillion: 0.15,
            outputUsdPerMillion: 0.60,
            cacheReadInputMultiplier: null,
            source: DEEPINFRA_PRICING_SOURCE,
            sourceRetrievedAt: OSS_FRONTIER_PRICING_SOURCE_RETRIEVED_AT,
        },
        {
            provider: "alibaba_dashscope_us_virginia",
            model: "qwen3-235b-a22b-instruct-2507",
            inputUsdPerMillion: 0.23,
            outputUsdPerMillion: 0.92,
            cacheReadInputMultiplier: null,
            source: ALIBABA_MODEL_STUDIO_PRICING_SOURCE,
            sourceRetrievedAt: OSS_FRONTIER_PRICING_SOURCE_RETRIEVED_AT,
        },
        {
            provider: "moonshot_kimi",
            model: "kimi-k2.7-code",
            inputUsdPerMillion: 0.95,
            outputUsdPerMillion: 4.00,
            cacheReadInputMultiplier: 0.19 / 0.95,
            source: KIMI_PRICING_SOURCE,
            sourceRetrievedAt: OSS_FRONTIER_PRICING_SOURCE_RETRIEVED_AT,
        },
        {
            provider: "zai",
            model: "glm-5.2",
            inputUsdPerMillion: 1.40,
            outputUsdPerMillion: 4.40,
            cacheReadInputMultiplier: 0.26 / 1.40,
            source: ZAI_PRICING_SOURCE,
            sourceRetrievedAt: OSS_FRONTIER_PRICING_SOURCE_RETRIEVED_AT,
        },
    ];
}
function openRouterPlaneForPinnedProvider(providerSlug) {
    return `${OPENROUTER_PLANE}:${providerSlug}`;
}
function openRouterEndpointPricingRows() {
    return [
        {
            provider: "openrouter",
            model: "meta-llama/llama-4-maverick",
            inputUsdPerMillion: 0.35,
            outputUsdPerMillion: 1.00,
            cacheReadInputMultiplier: 0.17 / 0.35,
            plane: openRouterPlaneForPinnedProvider("parasail/fp8"),
            source: OPENROUTER_LLAMA_4_MAVERICK_ENDPOINTS_SOURCE,
            sourceRetrievedAt: OPENROUTER_PRICING_SOURCE_RETRIEVED_AT,
        },
        {
            provider: "openrouter",
            model: "deepseek/deepseek-v4-pro",
            inputUsdPerMillion: 0.435,
            outputUsdPerMillion: 0.87,
            cacheReadInputMultiplier: 0.003625 / 0.435,
            plane: openRouterPlaneForPinnedProvider("deepseek"),
            source: OPENROUTER_DEEPSEEK_V4_PRO_ENDPOINTS_SOURCE,
            sourceRetrievedAt: OPENROUTER_PRICING_SOURCE_RETRIEVED_AT,
        },
        {
            provider: "openrouter",
            model: "deepseek/deepseek-v3.2",
            inputUsdPerMillion: 0.26,
            outputUsdPerMillion: 0.38,
            cacheReadInputMultiplier: 0.13 / 0.26,
            plane: openRouterPlaneForPinnedProvider("deepinfra/fp4"),
            source: OPENROUTER_DEEPSEEK_V3_2_ENDPOINTS_SOURCE,
            sourceRetrievedAt: OPENROUTER_PRICING_SOURCE_RETRIEVED_AT,
        },
        {
            provider: "openrouter",
            model: "qwen/qwen3-235b-a22b-2507",
            inputUsdPerMillion: 0.09,
            outputUsdPerMillion: 0.10,
            cacheReadInputMultiplier: null,
            plane: openRouterPlaneForPinnedProvider("deepinfra/fp8"),
            source: OPENROUTER_QWEN3_235B_ENDPOINTS_SOURCE,
            sourceRetrievedAt: OPENROUTER_PRICING_SOURCE_RETRIEVED_AT,
        },
        {
            provider: "openrouter",
            model: "mistralai/mistral-large-2512",
            inputUsdPerMillion: 0.50,
            outputUsdPerMillion: 1.50,
            cacheReadInputMultiplier: 0.05 / 0.50,
            plane: openRouterPlaneForPinnedProvider("mistral"),
            source: OPENROUTER_MISTRAL_LARGE_2512_ENDPOINTS_SOURCE,
            sourceRetrievedAt: OPENROUTER_PRICING_SOURCE_RETRIEVED_AT,
        },
        {
            provider: "openrouter",
            model: "moonshotai/kimi-k2.7-code",
            inputUsdPerMillion: 0.95,
            outputUsdPerMillion: 4.00,
            cacheReadInputMultiplier: 0.19 / 0.95,
            plane: openRouterPlaneForPinnedProvider("moonshotai/int4"),
            source: OPENROUTER_KIMI_K2_7_CODE_ENDPOINTS_SOURCE,
            sourceRetrievedAt: OPENROUTER_PRICING_SOURCE_RETRIEVED_AT,
        },
        {
            provider: "openrouter",
            model: "z-ai/glm-5.2",
            inputUsdPerMillion: 1.40,
            outputUsdPerMillion: 4.40,
            cacheReadInputMultiplier: 0.26 / 1.40,
            plane: openRouterPlaneForPinnedProvider("z-ai/fp8"),
            source: OPENROUTER_GLM_5_2_ENDPOINTS_SOURCE,
            sourceRetrievedAt: OPENROUTER_PRICING_SOURCE_RETRIEVED_AT,
        },
    ];
}
export function registerModelPricing(pricing) {
    modelPricing.push(pricingEntryFromModelPricing(pricing));
}
export function registerDefaultModelPricing() {
    for (const pricing of DEFAULT_MODEL_PRICING) {
        registerModelPricing(pricing);
    }
}
export function clearModelPricing() {
    modelPricing.length = 0;
}
export function listStaticRoutedModelOptions() {
    return registryRoutedModelOptions().map((option) => ({
        ...option,
        source: "packages/measure/src/pricing.ts:modelPricing route-compatible registry rows",
    }));
}
export function listModelPricingRegistryEntries() {
    return modelPricing.map((entry) => ({
        provider: entry.provider,
        model: entry.model,
        modelPattern: entry.modelPattern?.source ?? null,
        routeCompatibleModel: routedModelCandidateForPricingEntry(entry)?.model ?? null,
        routeCapabilities: routedModelCandidateForPricingEntry(entry)?.routeCapabilities ?? [],
        effectiveFrom: entry.effectiveFrom,
        effectiveTo: entry.effectiveTo,
        source: entry.source,
        sourceRetrievedAt: entry.sourceRetrievedAt,
        pricingVersion: entry.pricingVersion,
        plane: entry.plane,
        serviceTiers: entry.serviceTiers,
        promptTokenMinExclusive: entry.promptTokenMinExclusive,
        promptTokenMaxInclusive: entry.promptTokenMaxInclusive,
    }));
}
export function listPricedModelOptions(input = {}) {
    const eventTime = input.eventTime ?? new Date().toISOString();
    return registryRoutedModelOptions().flatMap((option) => {
        if (input.provider && option.provider !== input.provider)
            return [];
        const lookup = lookupPrice({
            provider: option.provider,
            model: option.model,
            eventTime,
            usage: { input: 1, output: 1 },
            ...(option.plane ? { plane: option.plane } : {}),
        });
        if (!lookup.ok || lookup.pricingStatus !== "priced")
            return [];
        return [{
                ...option,
                pricingVersion: lookup.pricingVersion,
                source: lookup.source,
                sourceRetrievedAt: lookup.sourceRetrievedAt,
                pricingStatus: "priced",
            }];
    });
}
function registryRoutedModelOptions() {
    const byModel = new Map();
    for (const entry of modelPricing) {
        const option = routedModelCandidateForPricingEntry(entry);
        if (!option)
            continue;
        byModel.set(`${option.provider}:${option.model}:${option.plane ?? ""}`, option);
    }
    return [...byModel.values()].sort((left, right) => `${left.provider}:${left.model}:${left.plane ?? ""}`.localeCompare(`${right.provider}:${right.model}:${right.plane ?? ""}`));
}
function routedModelCandidateForPricingEntry(entry) {
    const model = entry.model ?? displayModelFromPattern(entry.modelPattern);
    if (!model)
        return null;
    const routeCapabilities = routeCapabilitiesForModel(entry.provider, model);
    if (routeCapabilities.length === 0)
        return null;
    return {
        provider: entry.provider,
        model,
        routeCapabilities,
        ...(entry.plane ? { plane: entry.plane } : {}),
    };
}
function displayModelFromPattern(pattern) {
    if (!pattern)
        return null;
    const source = pattern.source;
    const datedAnthropicMatch = /^\^([a-z0-9-]+)\(\?:-\\d\{8\}\)\?\$$/.exec(source);
    if (datedAnthropicMatch)
        return datedAnthropicMatch[1] ?? null;
    return null;
}
function routeCapabilitiesForModel(provider, model) {
    if (provider === "openai") {
        if (model.startsWith("gpt-"))
            return ["chat.completions", "responses"];
        return [];
    }
    if (provider === "anthropic") {
        if (model.startsWith("claude-"))
            return ["messages"];
        return [];
    }
    if (provider === "gemini") {
        if (model.startsWith("gemini-"))
            return ["gemini.generateContent"];
        return [];
    }
    if (provider === "openrouter") {
        if (model.includes("/"))
            return ["chat.completions", "openai_compatible_chat"];
        return [];
    }
    return [];
}
export function tokensBilledForEvent(event) {
    return event.usage.input +
        event.usage.output +
        (event.usage.cache?.read ?? 0) +
        (event.usage.cache?.creation ?? 0);
}
export function roundUsd(value) {
    return Math.round(value * USD_PRECISION) / USD_PRECISION;
}
/**
 * @contract-id pricing-registry-lookup
 */
export function lookupPrice(input) {
    const billedCategories = billedCategoriesForUsage(input.usage);
    const entry = matchingPricingEntry(input);
    if (!entry) {
        return pricingUnknownResult(input, billedCategories);
    }
    const components = billedCategories.map((category) => pricingComponentForCategory(entry, category));
    const expectedChargeUsd = roundUsd(components.reduce(sumPricedCharges, 0));
    const pricingStatus = components.some((component) => component.pricingStatus === "unpriced")
        ? "partial"
        : "priced";
    return {
        ok: true,
        pricingVersion: entry.pricingVersion,
        source: entry.source,
        sourceRetrievedAt: entry.sourceRetrievedAt,
        currency: entry.currency,
        expectedChargeUsd,
        pricingStatus,
        components,
    };
}
export function lookupPriceForEvent(event) {
    return lookupPriceForEventModel(event, event.request.model);
}
export function lookupPriceForEventModel(event, model) {
    const usage = normalizedUsageFromEvent(event);
    return lookupPrice({
        provider: event.request.provider,
        model,
        eventTime: event.timing.startedAt,
        usage,
        plane: event.request.provider === "openrouter"
            ? openRouterPlaneForObservedEndpointModel(event, model)
            : providerPlaneFromEvent(event),
    });
}
export function estimateCostUsd(event) {
    const result = lookupPriceForEvent(event);
    return result.ok ? result.expectedChargeUsd : 0;
}
function pricingEntryFromModelPricing(pricing) {
    if (!pricing.model && !pricing.modelPattern) {
        throw new Error("Model pricing requires model or modelPattern.");
    }
    const cacheReadRate = pricing.cacheReadInputMultiplier === null
        ? undefined
        : pricing.inputUsdPerMillion *
            (pricing.cacheReadInputMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER);
    const cacheCreationMultiplier = pricing.cacheCreationInputMultiplier ?? 1;
    const oneHourMultiplier = pricing.anthropicCacheCreationOneHourInputMultiplier ?? 2;
    return {
        provider: pricing.provider,
        model: pricing.model ?? null,
        modelPattern: pricing.modelPattern ?? null,
        effectiveFrom: pricing.effectiveFrom ?? DEFAULT_EFFECTIVE_FROM,
        effectiveTo: pricing.effectiveTo ?? null,
        source: pricing.source ?? "code-backed pricing registry entry",
        sourceRetrievedAt: pricing.sourceRetrievedAt ?? null,
        currency: "USD",
        unit: "tokens",
        pricingVersion: pricing.pricingVersion ?? DEFAULT_PRICING_VERSION,
        ratesUsdPerMillion: compactRates({
            input: pricing.inputUsdPerMillion,
            output: pricing.outputUsdPerMillion,
            cache_read: cacheReadRate,
            cache_creation: pricing.inputUsdPerMillion * cacheCreationMultiplier,
            anthropic_cache_creation_5m: pricing.inputUsdPerMillion * cacheCreationMultiplier,
            anthropic_cache_creation_1h: pricing.inputUsdPerMillion * oneHourMultiplier,
            reasoning: pricing.reasoningUsdPerMillion,
            tool: pricing.toolUsdPerMillion,
            audio: pricing.audioUsdPerMillion,
            audio_input: pricing.audioInputUsdPerMillion,
            audio_cache_read: pricing.audioCacheReadUsdPerMillion,
            gemini_thinking: pricing.outputUsdPerMillion,
        }),
        plane: pricing.plane ?? null,
        serviceTiers: pricing.serviceTiers ?? (pricing.serviceTier ? [pricing.serviceTier] : null),
        promptTokenMinExclusive: pricing.promptTokenMinExclusive ?? null,
        promptTokenMaxInclusive: pricing.promptTokenMaxInclusive ?? null,
    };
}
function compactRates(rates) {
    const compacted = {};
    for (const [category, rate] of Object.entries(rates)) {
        if (rate !== undefined)
            compacted[category] = rate;
    }
    return compacted;
}
function matchingPricingEntry(input) {
    if (hasUnpricedPricingDimension(input))
        return undefined;
    const eventTime = new Date(input.eventTime).getTime();
    const model = canonicalModelForPricing(input.provider, input.model);
    for (let index = modelPricing.length - 1; index >= 0; index -= 1) {
        const entry = modelPricing[index];
        if (entry &&
            entry.provider === input.provider &&
            pricingEntryMatchesModel(entry, model) &&
            pricingEntryMatchesPlane(entry, input) &&
            pricingEntryMatchesServiceTier(entry, input.usage.serviceTier) &&
            pricingEntryMatchesPromptTokens(entry, input.usage) &&
            effectiveAt(entry, eventTime)) {
            return entry;
        }
    }
    return undefined;
}
function canonicalModelForPricing(provider, model) {
    const trimmed = model.trim();
    if (provider === "gemini" && trimmed.startsWith("models/")) {
        return trimmed.slice("models/".length);
    }
    return trimmed;
}
function pricingEntryMatchesPlane(entry, input) {
    if (!entry.plane)
        return input.plane === undefined;
    return input.plane === entry.plane;
}
function pricingEntryMatchesModel(entry, model) {
    if (entry.model === model)
        return true;
    if (!entry.modelPattern)
        return false;
    entry.modelPattern.lastIndex = 0;
    return entry.modelPattern.test(model);
}
function pricingEntryMatchesServiceTier(entry, serviceTier) {
    if (!entry.serviceTiers || entry.serviceTiers.length === 0)
        return true;
    const normalized = normalizeServiceTier(serviceTier);
    return entry.serviceTiers.map(normalizeServiceTier).includes(normalized);
}
function normalizeServiceTier(serviceTier) {
    return (serviceTier ?? "standard").toLowerCase().replace(/[^a-z0-9]+/g, "_");
}
function hasUnpricedPricingDimension(input) {
    if (hasUnpricedServiceTierDimension(input))
        return true;
    if (hasUnpricedWorkloadClassDimension(input))
        return true;
    if (hasUnpricedInferenceGeoDimension(input))
        return true;
    if (hasUnpricedContextTierDimension(input))
        return true;
    return false;
}
function hasUnpricedServiceTierDimension(input) {
    if (input.provider !== "openai" && input.provider !== "anthropic")
        return false;
    const serviceTier = normalizeOptionalDimension(input.usage.serviceTier);
    if (!serviceTier)
        return false;
    return !STANDARD_PRICE_SERVICE_TIERS.has(serviceTier);
}
function hasUnpricedWorkloadClassDimension(input) {
    if (input.provider !== "openai" && input.provider !== "anthropic")
        return false;
    return normalizeOptionalDimension(input.usage.workloadClass) === "batch";
}
function hasUnpricedInferenceGeoDimension(input) {
    const inferenceGeo = normalizeOptionalDimension(input.usage.inferenceGeo);
    if (!inferenceGeo)
        return false;
    if (input.provider === "anthropic")
        return inferenceGeo !== "global";
    if (input.provider === "openai")
        return !GLOBAL_PRICE_REGION_VALUES.has(inferenceGeo);
    return false;
}
function hasUnpricedContextTierDimension(input) {
    if (input.provider !== "openai")
        return false;
    const contextTier = normalizeOptionalDimension(input.usage.contextTier);
    if (!contextTier)
        return false;
    return !STANDARD_CONTEXT_TIER_VALUES.has(contextTier);
}
const STANDARD_PRICE_SERVICE_TIERS = new Set(["default", "standard"]);
const GLOBAL_PRICE_REGION_VALUES = new Set(["default", "global", "standard"]);
const STANDARD_CONTEXT_TIER_VALUES = new Set(["default", "standard", "short", "short_context"]);
function normalizeOptionalDimension(value) {
    if (!value)
        return null;
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return normalized.length > 0 ? normalized : null;
}
function pricingEntryMatchesPromptTokens(entry, usage) {
    const promptTokens = usage.input + (usage.cache?.read ?? 0);
    if (entry.promptTokenMinExclusive !== null && promptTokens <= entry.promptTokenMinExclusive)
        return false;
    if (entry.promptTokenMaxInclusive !== null && promptTokens > entry.promptTokenMaxInclusive)
        return false;
    return true;
}
function effectiveAt(entry, eventTime) {
    const from = new Date(entry.effectiveFrom).getTime();
    const to = entry.effectiveTo ? new Date(entry.effectiveTo).getTime() : null;
    return eventTime >= from && (to === null || eventTime < to);
}
function pricingUnknownResult(input, categories) {
    return {
        ok: false,
        reason: "pricing_unknown",
        provider: input.provider,
        model: input.model,
        usageCategories: categories.map((category) => category.category),
    };
}
function pricingComponentForCategory(entry, category) {
    const rate = entry.ratesUsdPerMillion[category.category];
    if (rate === undefined) {
        return {
            category: category.category,
            quantity: category.quantity,
            unit: entry.unit,
            rateUsdPerMillion: null,
            chargeUsd: null,
            pricingStatus: "unpriced",
        };
    }
    return {
        category: category.category,
        quantity: category.quantity,
        unit: entry.unit,
        rateUsdPerMillion: rate,
        chargeUsd: roundUsd((category.quantity * rate) / 1_000_000),
        pricingStatus: "priced",
    };
}
function sumPricedCharges(total, component) {
    return total + (component.chargeUsd ?? 0);
}
function normalizedUsageFromEvent(event) {
    const usage = event.usage;
    const response = event.response;
    const request = event.request;
    return {
        input: usage.input,
        output: usage.output,
        ...(usage.cache ? { cache: usage.cache } : {}),
        ...(usage.categories ? { categories: usage.categories } : {}),
        ...(usage.serviceTier ?? response.serviceTier
            ? { serviceTier: usage.serviceTier ?? response.serviceTier }
            : {}),
        ...(usage.inferenceGeo ? { inferenceGeo: usage.inferenceGeo } : {}),
        ...(request.workloadClass ? { workloadClass: request.workloadClass } : {}),
        ...(contextTierFromGeneration(request.generation)
            ? { contextTier: contextTierFromGeneration(request.generation) }
            : {}),
    };
}
function contextTierFromGeneration(generation) {
    return stringValueFromRecord(generation, "contextTier") ??
        stringValueFromRecord(generation, "context_tier") ??
        stringValueFromRecord(generation, "promptContextTier") ??
        stringValueFromRecord(generation, "prompt_context_tier");
}
function providerPlaneFromEvent(event) {
    const request = event.request;
    return request.providerPlane;
}
function openRouterPlaneForObservedEndpointModel(event, model) {
    const identity = openRouterObservedEndpointIdentity(event);
    if (!identity || canonicalModelForPricing("openrouter", model) !== identity.model)
        return undefined;
    return identity.plane;
}
function openRouterObservedEndpointIdentity(event) {
    const response = event.response;
    const stopDetails = response.stopDetails?.openRouter;
    const openRouter = isRecord(stopDetails) ? stopDetails : undefined;
    const selectedProvider = stringValueFromRecord(openRouter, "selectedUpstreamProvider");
    const selectedModel = stringValueFromRecord(openRouter, "selectedUpstreamModel");
    const endpointQuantization = stringValueFromRecord(openRouter, "endpointQuantization");
    const metadataStatus = stringValueFromRecord(openRouter, "metadataStatus");
    const metadataFieldPath = stringValueFromRecord(openRouter, "metadataFieldPath");
    const endpointPrice = isRecord(openRouter?.endpointPriceSnapshot) ? openRouter.endpointPriceSnapshot :
        isRecord(openRouter?.endpointPrice) ? openRouter.endpointPrice :
            undefined;
    if (!selectedProvider ||
        !selectedModel ||
        metadataStatus !== "captured" ||
        !metadataFieldPath?.includes(".openrouter_metadata.endpoints.available") ||
        !endpointPrice) {
        return undefined;
    }
    const selectedPricingModel = canonicalModelForPricing("openrouter", selectedModel);
    for (const providerSlug of openRouterEndpointProviderSlugCandidates(selectedProvider, endpointQuantization)) {
        const plane = openRouterPlaneForPinnedProvider(providerSlug);
        const entry = matchingPricingEntry({
            provider: "openrouter",
            model: selectedPricingModel,
            eventTime: event.timing.startedAt,
            usage: { input: 0, output: 0 },
            plane,
        });
        if (entry && openRouterEndpointPriceSnapshotMatchesEntry(endpointPrice, entry)) {
            return { model: selectedPricingModel, plane };
        }
    }
    return undefined;
}
function openRouterEndpointProviderSlugCandidates(selectedProvider, endpointQuantization) {
    const candidates = [selectedProvider];
    if (endpointQuantization && !selectedProvider.includes("/")) {
        candidates.push(`${selectedProvider}/${endpointQuantization}`);
    }
    return [...new Set(candidates)];
}
function openRouterEndpointPriceSnapshotMatchesEntry(endpointPrice, entry) {
    return openRouterEndpointRateMatches(endpointPrice, ["prompt", "input"], entry.ratesUsdPerMillion.input) &&
        openRouterEndpointRateMatches(endpointPrice, ["completion", "output"], entry.ratesUsdPerMillion.output) &&
        openRouterEndpointRateMatches(endpointPrice, ["cache_read", "cacheRead"], entry.ratesUsdPerMillion.cache_read);
}
function openRouterEndpointRateMatches(endpointPrice, fieldNames, expectedUsdPerMillion) {
    if (expectedUsdPerMillion === undefined)
        return true;
    const observedUsdPerMillion = openRouterEndpointUsdPerMillion(endpointPrice, fieldNames);
    return observedUsdPerMillion !== null &&
        Math.abs(observedUsdPerMillion - expectedUsdPerMillion) <= 0.000000001;
}
function openRouterEndpointUsdPerMillion(endpointPrice, fieldNames) {
    for (const fieldName of fieldNames) {
        const value = endpointPrice[fieldName];
        if (typeof value !== "string" && typeof value !== "number")
            continue;
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0)
            return parsed * 1_000_000;
    }
    return null;
}
function stringValueFromRecord(record, key) {
    const value = record?.[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function billedCategoriesForUsage(usage) {
    const categories = new Map();
    const hasTtlSpecificCreation = hasAnthropicTtlSpecificCreation(usage.categories);
    const audioInput = categoryTokenTotal(usage.categories, "audio_input");
    const audioCacheRead = categoryTokenTotal(usage.categories, "audio_cache_read");
    addCategory(categories, "input", Math.max(0, usage.input - audioInput));
    addCategory(categories, "output", usage.output);
    addCategory(categories, "cache_read", Math.max(0, (usage.cache?.read ?? 0) - audioCacheRead));
    addGenericCacheCreation(categories, usage, hasTtlSpecificCreation);
    for (const category of usage.categories ?? []) {
        addCanonicalUsageCategory(categories, category, hasTtlSpecificCreation);
    }
    return [...categories.entries()].map(([category, quantity]) => ({ category, quantity }));
}
function categoryTokenTotal(usageCategories, canonicalName) {
    return (usageCategories ?? [])
        .filter((category) => canonicalCategoryName(category.category) === canonicalName)
        .reduce((total, category) => total + category.tokens, 0);
}
function addGenericCacheCreation(categories, usage, hasTtlSpecificCreation) {
    if (!hasTtlSpecificCreation)
        addCategory(categories, "cache_creation", usage.cache?.creation ?? 0);
}
function hasAnthropicTtlSpecificCreation(usageCategories) {
    return usageCategories?.some((category) => canonicalCategoryName(category.category).startsWith("anthropic_cache_creation_")) ?? false;
}
function addCanonicalUsageCategory(categories, usageCategory, hasTtlSpecificCreation) {
    if (isNonBillableUsageCategory(usageCategory.category))
        return;
    const canonicalCategory = canonicalCategoryName(usageCategory.category);
    if (hasTtlSpecificCreation && canonicalCategory === "cache_creation")
        return;
    if (isDuplicateCanonicalCategory(categories, canonicalCategory))
        return;
    addCategory(categories, canonicalCategory, usageCategory.tokens);
}
function isNonBillableUsageCategory(category) {
    if (category === "gemini_thinking")
        return false;
    if (category === "gemini_thinking_unverified")
        return false;
    return category === "provider:openai:total_tokens" ||
        category === "provider:openai_responses:total_tokens" ||
        /^provider:(?:mistral|deepseek_platform|deepinfra|alibaba_dashscope_us_virginia|moonshot_kimi|zai|together|groq|openrouter):total_tokens$/.test(category) ||
        category === "provider:openrouter:cost" ||
        category.startsWith("provider:openrouter:cost_details.") ||
        isWaveACaptureOnlyUsageCategory(category) ||
        isHiddenOutputUsageCategory(category);
}
function isWaveACaptureOnlyUsageCategory(category) {
    return category === "provider:gemini:totalTokenCount" ||
        category === "provider:gemini:toolUsePromptTokenCount";
}
function canonicalCategoryName(category) {
    switch (category) {
        case "prompt":
            return "input";
        case "completion":
            return "output";
        case "gemini_thinking":
            return "gemini_thinking";
        case "gemini_thinking_unverified":
            return "gemini_thinking_unverified";
        case "audio_input":
            return "audio_input";
        case "audio_cache_read":
            return "audio_cache_read";
        case "cached":
        case "cache_read":
            return "cache_read";
        case "anthropic_cache_creation":
        case "cache_creation":
            return "cache_creation";
        case "cache_creation_5m":
        case "anthropic_cache_creation_5m":
        case "anthropic_cache_creation_ephemeral_5m":
            return "anthropic_cache_creation_5m";
        case "cache_creation_1h":
        case "anthropic_cache_creation_1h":
        case "anthropic_cache_creation_ephemeral_1h":
            return "anthropic_cache_creation_1h";
        default:
            return canonicalProviderCategoryName(category);
    }
}
function canonicalProviderCategoryName(category) {
    const openAiCompatible = openAiCompatibleProviderCategoryName(category);
    if (openAiCompatible)
        return openAiCompatible;
    switch (category) {
        case "provider:openai:prompt_tokens":
        case "provider:openai_responses:input_tokens":
        case "provider:anthropic:input_tokens":
            return "input";
        case "provider:openai:completion_tokens":
        case "provider:openai_responses:output_tokens":
        case "provider:anthropic:output_tokens":
            return "output";
        case "provider:openai:prompt_tokens_details.cached_tokens":
        case "provider:openai_responses:input_tokens_details.cached_tokens":
        case "provider:anthropic:cache_read_input_tokens":
            return "cache_read";
        case "provider:anthropic:cache_creation_input_tokens":
            return "cache_creation";
        case "provider:anthropic:cache_creation.ephemeral_5m_input_tokens":
            return "anthropic_cache_creation_5m";
        case "provider:anthropic:cache_creation.ephemeral_1h_input_tokens":
            return "anthropic_cache_creation_1h";
        case "provider:gemini:promptTokenCount":
            return "input";
        case "provider:gemini:candidatesTokenCount":
            return "output";
        case "provider:gemini:cachedContentTokenCount":
            return "cache_read";
        case "provider:gemini:thoughtsTokenCount":
            return "gemini_thinking_unverified";
        case "provider:gemini:promptTokensDetails.AUDIO":
            return "audio_input";
        case "provider:gemini:cacheTokensDetails.AUDIO":
            return "audio_cache_read";
        case "completion_tokens_details.reasoning_tokens":
        case "output_tokens_details.reasoning_tokens":
        case "provider:openai:completion_tokens_details.reasoning_tokens":
        case "provider:openai:output_tokens_details.reasoning_tokens":
        case "provider:anthropic:output_tokens_details.thinking_tokens":
            return "reasoning";
        default:
            return category;
    }
}
function openAiCompatibleProviderCategoryName(category) {
    const match = /^provider:(mistral|deepseek_platform|deepinfra|alibaba_dashscope_us_virginia|moonshot_kimi|zai|together|groq|openrouter):(.+)$/.exec(category);
    const path = match?.[2];
    switch (path) {
        case "prompt_tokens":
            return "input";
        case "completion_tokens":
            return "output";
        case "prompt_tokens_details.cached_tokens":
            return "cache_read";
        case "completion_tokens_details.reasoning_tokens":
            return "reasoning";
        default:
            return null;
    }
}
function isDuplicateCanonicalCategory(categories, category) {
    return [
        "input",
        "output",
        "cache_read",
        "cache_creation",
        "anthropic_cache_creation_5m",
        "anthropic_cache_creation_1h",
        "gemini_thinking",
        "gemini_thinking_unverified",
        "audio_input",
        "audio_cache_read",
    ].includes(category) &&
        categories.has(category);
}
function addCategory(categories, category, quantity) {
    if (quantity <= 0)
        return;
    categories.set(category, (categories.get(category) ?? 0) + quantity);
}
registerDefaultModelPricing();
//# sourceMappingURL=pricing.js.map