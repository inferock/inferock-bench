import { reliabilityEndpoint } from "./config.js";
export function buildReliabilityIndexPayload(summary) {
    return {
        schemaVersion: "inferock-bench-reliability-index-v1",
        generatedAt: new Date().toISOString(),
        period: summary.period,
        measuredCalls: summary.measuredCalls,
        failureCounts: summary.rows.map((row) => ({
            failureClass: row.failureClass,
            evidenceGrade: row.evidenceGrade,
            count: row.count,
        })),
    };
}
export async function sendReliabilityIndexPayload(input) {
    const payload = buildReliabilityIndexPayload(input.summary);
    if (input.config.reliabilityIndex?.enabled !== true) {
        return {
            sent: false,
            message: "reliability index is off",
            payload,
        };
    }
    const endpoint = reliabilityEndpoint(input.config, input.env);
    if (!endpoint) {
        return {
            sent: false,
            message: "index endpoint not yet live; payload assembled locally only",
            payload,
        };
    }
    return {
        sent: false,
        message: "index endpoint configured, but sender is disabled until the reliability index is live",
        payload,
    };
}
//# sourceMappingURL=telemetry.js.map