import type { CanonicalEventV1 } from "./canonical-event.js";
import type { LossSignal } from "./types.js";
export declare const STANDARD_LOSS_METHOD_VERSION = "dollarcore-2026-07-04";
export declare function applyStandardLossEconomicsToSignals(event: CanonicalEventV1, signals: readonly LossSignal[]): LossSignal[];
//# sourceMappingURL=standard-loss.d.ts.map