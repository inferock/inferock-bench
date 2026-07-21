import type { CanonicalEventV1 } from "./canonical-event.js";
import type { LossSignal } from "./types.js";
export declare const STANDARD_LOSS_METHOD_VERSION = "dollarcore-2026-07-04";
export interface PublicTimeLossEvent {
    readonly request: CanonicalEventV1["request"] & {
        readonly operationId?: string;
        readonly bodyHash?: string;
        readonly apiKeyHash?: string;
    };
    readonly timing: CanonicalEventV1["timing"];
}
export interface PublicTimeLossSignal {
    readonly code: string;
    readonly failureClass?: string | null;
    readonly valueKind?: string;
    readonly valueJson?: Record<string, unknown>;
    readonly evidence?: Record<string, unknown>;
    readonly computationTrace?: Record<string, unknown> | null;
}
export interface PublicTimeLossSignalEntry {
    readonly event: PublicTimeLossEvent;
    readonly signal: PublicTimeLossSignal;
}
export interface PublicTimeLossInterval {
    readonly logicalOperationKey: string;
    readonly signalCode: string;
    readonly failureClass: string | null;
    readonly requestId: string;
    readonly startedAt: string | null;
    readonly endedAt: string | null;
    readonly rawTimeLossMs: number;
    readonly publicTimeLossMs: number;
    readonly demoted: boolean;
    readonly demotionReason: string | null;
}
export interface PublicTimeLossTotals {
    readonly rawTimeLossMs: number;
    readonly timeLossMs: number;
    readonly providerRecognizedTimeLossMs: number;
    readonly recognitionGapTimeMs: number;
    readonly dollarTranslationUsd: number;
    readonly intervals: readonly PublicTimeLossInterval[];
}
export declare function applyStandardLossEconomicsToSignals(event: CanonicalEventV1, signals: readonly LossSignal[]): LossSignal[];
export declare function applyBillBoundedMoneyLossCapToSignals(event: CanonicalEventV1, signals: readonly LossSignal[]): LossSignal[];
export declare function publicTimeLossTotalsForSignals(entries: readonly PublicTimeLossSignalEntry[], options?: {
    readonly rateUsdPerHour?: number;
}): PublicTimeLossTotals;
//# sourceMappingURL=standard-loss.d.ts.map