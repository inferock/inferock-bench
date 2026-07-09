import type { CanonicalEventV1 } from "./canonical-event.js";
export declare const GEMINI_DEVELOPER_API_PLANE = "gemini_developer_api";
export declare const OPENROUTER_PLANE = "openrouter_openai_compatible";
export type Provider = CanonicalEventV1["request"]["provider"];
type PricingStatus = "priced" | "partial";
export interface NormalizedUsageCategory {
    readonly category: string;
    readonly tokens: number;
    readonly sourceField?: string;
    readonly provider?: Provider;
}
export interface NormalizedUsage {
    readonly input: number;
    readonly output: number;
    readonly cache?: {
        readonly read?: number;
        readonly creation?: number;
    };
    readonly categories?: readonly NormalizedUsageCategory[];
    readonly serviceTier?: string;
    readonly inferenceGeo?: string;
    readonly workloadClass?: string;
    readonly contextTier?: string;
}
export interface PricingComponent {
    readonly category: string;
    readonly quantity: number;
    readonly unit: "tokens";
    readonly rateUsdPerMillion: number | null;
    readonly chargeUsd: number | null;
    readonly pricingStatus: "priced" | "unpriced";
}
export interface PriceLookupInput {
    readonly provider: Provider;
    readonly model: string;
    readonly eventTime: string;
    readonly usage: NormalizedUsage;
    readonly plane?: string;
}
export type PriceLookupResult = {
    readonly ok: true;
    readonly pricingVersion: string;
    readonly source: string;
    readonly sourceRetrievedAt: string | null;
    readonly currency: "USD";
    readonly expectedChargeUsd: number;
    readonly pricingStatus: PricingStatus;
    readonly components: readonly PricingComponent[];
} | {
    readonly ok: false;
    readonly reason: "pricing_unknown";
    readonly provider: string;
    readonly model: string;
    readonly usageCategories: readonly string[];
};
export interface ModelPricing {
    readonly provider: Provider;
    readonly model?: string;
    readonly modelPattern?: RegExp;
    readonly inputUsdPerMillion: number;
    readonly outputUsdPerMillion: number;
    readonly cacheReadInputMultiplier?: number | null;
    readonly cacheCreationInputMultiplier?: number;
    readonly anthropicCacheCreationOneHourInputMultiplier?: number;
    readonly reasoningUsdPerMillion?: number;
    readonly toolUsdPerMillion?: number;
    readonly audioUsdPerMillion?: number;
    readonly audioInputUsdPerMillion?: number;
    readonly audioCacheReadUsdPerMillion?: number;
    readonly serviceTier?: string;
    readonly serviceTiers?: readonly string[];
    readonly promptTokenMinExclusive?: number;
    readonly promptTokenMaxInclusive?: number;
    readonly plane?: string;
    readonly effectiveFrom?: string;
    readonly effectiveTo?: string | null;
    readonly source?: string;
    readonly sourceRetrievedAt?: string;
    readonly pricingVersion?: string;
}
export interface PricedModelOption {
    readonly provider: Provider;
    readonly model: string;
    readonly routeCapabilities: readonly string[];
    readonly pricingVersion: string;
    readonly source: string;
    readonly sourceRetrievedAt: string | null;
    readonly plane?: string;
    readonly pricingStatus: "priced";
}
export interface StaticRoutedModelOption {
    readonly provider: Provider;
    readonly model: string;
    readonly routeCapabilities: readonly string[];
    readonly source: string;
    readonly plane?: string;
}
export interface ModelPricingRegistryEntry {
    readonly provider: Provider;
    readonly model: string | null;
    readonly modelPattern: string | null;
    readonly routeCompatibleModel: string | null;
    readonly routeCapabilities: readonly string[];
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
    readonly source: string;
    readonly sourceRetrievedAt: string | null;
    readonly pricingVersion: string;
    readonly plane: string | null;
    readonly serviceTiers: readonly string[] | null;
    readonly promptTokenMinExclusive: number | null;
    readonly promptTokenMaxInclusive: number | null;
}
export interface ListPricedModelOptionsInput {
    readonly provider?: Provider;
    readonly eventTime?: string;
}
export declare function registerModelPricing(pricing: ModelPricing): void;
export declare function registerDefaultModelPricing(): void;
export declare function clearModelPricing(): void;
export declare function listStaticRoutedModelOptions(): readonly StaticRoutedModelOption[];
export declare function listModelPricingRegistryEntries(): readonly ModelPricingRegistryEntry[];
export declare function listPricedModelOptions(input?: ListPricedModelOptionsInput): readonly PricedModelOption[];
export declare function tokensBilledForEvent(event: CanonicalEventV1): number;
export declare function roundUsd(value: number): number;
/**
 * @contract-id pricing-registry-lookup
 */
export declare function lookupPrice(input: PriceLookupInput): PriceLookupResult;
export declare function lookupPriceForEvent(event: CanonicalEventV1): PriceLookupResult;
export declare function lookupPriceForEventModel(event: CanonicalEventV1, model: string): PriceLookupResult;
export declare function estimateCostUsd(event: CanonicalEventV1): number;
export {};
//# sourceMappingURL=pricing.d.ts.map