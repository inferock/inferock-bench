import type { CanonicalEventV1 } from "./canonical-event.js";
import type { PriceLookupResult } from "./pricing.js";
import type { LossSignal } from "./types.js";
export interface PricingSignalContext {
    readonly observedChargeUsd?: number;
    readonly observedChargeSource?: string;
    readonly observedAt?: string;
}
export declare function detectPricingStatusSignal(event: CanonicalEventV1): LossSignal | null;
export declare function buildPricingStatusSignal(event: CanonicalEventV1, priceLookup: PriceLookupResult, context?: PricingSignalContext): LossSignal | null;
//# sourceMappingURL=pricing-signal.d.ts.map