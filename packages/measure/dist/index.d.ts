import type { CanonicalEventV1 } from "./canonical-event.js";
import { type LatencySloPolicy } from "./latency.js";
import type { LossSignal } from "./types.js";
export interface DetectorOptions {
    readonly latencySloPolicy?: LatencySloPolicy | null;
}
/**
 * @contract-id loss-detectors-v1
 */
export declare function runDetectors(event: CanonicalEventV1, options?: DetectorOptions): LossSignal[];
export * from "./anthropic-token-crosscheck.js";
export * from "./availability.js";
export * from "./billing-integrity.js";
export * from "./broken-output.js";
export * from "./canonical-event.js";
export * from "./factuality.js";
export * from "./latency.js";
export * from "./model-identity.js";
export * from "./output-schemas.js";
export * from "./pricing.js";
export * from "./pricing-signal.js";
export * from "./security-secrets.js";
export * from "./refusals.js";
export * from "./retry-amplification.js";
export * from "./scorecard.js";
export * from "./security.js";
export * from "./signal.js";
export * from "./sla-defaults.js";
export * from "./standard-loss.js";
export * from "./stream-termination.js";
export * from "./time-loss.js";
export * from "./tool-call-validity.js";
export * from "./types.js";
export * from "./usage-categories.js";
//# sourceMappingURL=index.d.ts.map