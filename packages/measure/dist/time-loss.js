export const TIME_LOSS_METHOD_LATENCY_EXCESS = "latency_excess_v1";
export const TIME_LOSS_METHOD_DOWNTIME_WINDOW = "downtime_window_v1";
const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 3_600_000;
export function formatApproxTimeLost(ms) {
    const bounded = Number.isFinite(ms) && ms > 0 ? ms : 0;
    if (bounded < MILLISECONDS_PER_MINUTE) {
        return `~${Math.round(bounded / MILLISECONDS_PER_SECOND)}s`;
    }
    if (bounded < MILLISECONDS_PER_HOUR) {
        return `~${(bounded / MILLISECONDS_PER_MINUTE).toFixed(1)} min`;
    }
    return `~${(bounded / MILLISECONDS_PER_HOUR).toFixed(1)} hr`;
}
export function dollarTranslationForTimeLoss(timeLossMs, rateUsdPerHour) {
    if (!Number.isFinite(timeLossMs) || timeLossMs <= 0)
        return 0;
    if (!Number.isFinite(rateUsdPerHour) || rateUsdPerHour <= 0)
        return 0;
    return roundUsd(timeLossMs / MILLISECONDS_PER_HOUR * rateUsdPerHour);
}
function roundUsd(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
}
//# sourceMappingURL=time-loss.js.map