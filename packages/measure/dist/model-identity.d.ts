import type { CanonicalEventV1 } from "./canonical-event.js";
import type { LossSignal } from "./types.js";
export interface ServedModelMismatchBillingContext {
    readonly provenBilledModel?: string;
    readonly observedChargeUsd?: number;
    readonly observedChargeSource?: string;
    readonly observedAt?: string;
}
export interface ServedModelMismatchOptions {
    readonly billingContext?: ServedModelMismatchBillingContext;
}
/**
 * Detects provider-response model identity mismatches.
 *
 * Evidence gates are intentionally strict: only canonical v2 events with both
 * requested and provider-served model IDs, and with response.servedModelSource
 * explicitly set to provider_response, can emit.
 */
export declare function detectServedModelMismatch(event: CanonicalEventV1, options?: ServedModelMismatchOptions): LossSignal | null;
//# sourceMappingURL=model-identity.d.ts.map