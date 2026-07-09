import type { CanonicalEventV1 } from "./canonical-event.js";
import { type LatencySloPolicy } from "./latency.js";
import { estimateCostUsd } from "./pricing.js";
import type { LossSignal } from "./types.js";
export interface StatelessDetectorOptions {
    readonly latencySloPolicy?: LatencySloPolicy | null;
}
/**
 * @contract-id loss-detectors-v1
 */
export declare function runStatelessDetectors(event: CanonicalEventV1, options?: StatelessDetectorOptions): LossSignal[];
export { estimateCostUsd };
export { applyStandardLossEconomicsToSignals } from "./standard-loss.js";
export type { LossSignal };
//# sourceMappingURL=stateless.d.ts.map