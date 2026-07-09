export declare const TIME_LOSS_METHOD_LATENCY_EXCESS: "latency_excess_v1";
export declare const TIME_LOSS_METHOD_DOWNTIME_WINDOW: "downtime_window_v1";
export type TimeLossMethodId = typeof TIME_LOSS_METHOD_LATENCY_EXCESS | typeof TIME_LOSS_METHOD_DOWNTIME_WINDOW;
export declare function formatApproxTimeLost(ms: number): string;
export declare function dollarTranslationForTimeLoss(timeLossMs: number, rateUsdPerHour: number): number;
//# sourceMappingURL=time-loss.d.ts.map