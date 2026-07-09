export function dollarizeDriftCanaryRegression(input) {
    const canaryCalls = input.affectedCalls.filter((call) => call.kind === "canary");
    const customerCalls = input.affectedCalls.filter((call) => call.kind === "customer");
    const canaryCostUsd = roundUsd(sum(canaryCalls.map(appliedCostUsdForCall)));
    const customerCostUsd = roundUsd(sum(customerCalls.map(appliedCostUsdForCall)));
    const supersededCallCount = input.affectedCalls.filter((call) => call.supersededByExistingFloor).length;
    const standardLossUsd = roundUsd(canaryCostUsd + customerCostUsd);
    const providerRecognizedLossUsd = 0;
    const recognitionGapUsd = roundUsd(standardLossUsd - providerRecognizedLossUsd);
    return {
        methodId: "drift_canary_floor_v1",
        methodVersion: "drift-canary-method-v1-2026-07-04",
        failureClass: "drift_regression",
        evidenceGrade: "unrecognized_standard_loss",
        standardLossUsd,
        providerRecognizedLossUsd,
        recognitionGapUsd,
        affectedCallCount: input.affectedCalls.length,
        canaryCallCount: canaryCalls.length,
        customerCallCount: customerCalls.length,
        computationTrace: {
            method: "drift_canary_floor_v1",
            methodId: "drift_canary_floor_v1",
            methodVersion: "drift-canary-method-v1-2026-07-04",
            basis: "failed_to_deliver_drift_regression",
            grade: "unrecognized_standard_loss",
            confidence: "priced_window_cost_floor",
            inputs: {
                provider: input.provider,
                model: input.model,
                baseline: input.baseline,
                current: input.current,
                alpha: input.alpha,
                pValue: input.pValue,
                lastGoodRunId: input.lastGoodRunId,
                firstFlaggedRunId: input.firstFlaggedRunId,
                affectedWindow: input.window,
                affectedCallCount: input.affectedCalls.length,
                canaryCallCount: canaryCalls.length,
                customerCallCount: customerCalls.length,
                supersededCallCount,
                canaryCostUsd,
                customerCostUsd,
                evidenceGrades: {
                    canaryCalls: "higher",
                    customerCalls: "lower",
                },
                affectedRequestIds: input.affectedCalls.map((call) => ({
                    requestId: call.requestId,
                    kind: call.kind,
                    costUsd: call.costUsd,
                    appliedCostUsd: appliedCostUsdForCall(call),
                    ...(call.supersededByExistingFloor
                        ? {
                            supersededByExistingFloor: call.supersededByExistingFloor,
                            standardLossSupersessionReason: "one_call_cost_floor_per_call",
                            supersededMethodId: "call_cost_floor_superseded_v1",
                        }
                        : {}),
                })),
            },
            formulas: {
                standardLossUsd: "sum(provider-billed cost for degraded canary calls and same-model customer calls in the affected window, excluding calls whose whole-call floor was already attributed)",
                providerRecognizedLossUsd: "0 until provider recognizes the drift regression",
                recognitionGapUsd: "standardLossUsd - providerRecognizedLossUsd",
            },
            outputs: {
                standardLossUsd,
                providerRecognizedLossUsd,
                recognitionGapUsd,
            },
            sourceRefs: {
                methodPrecedent: [
                    "arXiv:2307.09009",
                    "arXiv:2410.20247",
                    "arXiv:2512.03816",
                ],
                nonDeterminism: "arXiv:2506.09501",
                datasets: [
                    "https://huggingface.co/datasets/madrylab/gsm8k-platinum",
                    "https://github.com/hendrycks/test",
                ],
                grading: "https://github.com/openai/simple-evals MIT exact-match pattern attribution; no copied code",
            },
            oneLine: `drift canary floor ${standardLossUsd.toFixed(6)} USD; provider-recognized 0.000000 USD -> ${recognitionGapUsd.toFixed(6)} USD recognition gap`,
        },
    };
}
function sum(values) {
    return values.reduce((total, value) => total + value, 0);
}
function appliedCostUsdForCall(call) {
    return call.appliedCostUsd ?? call.costUsd;
}
function roundUsd(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
}
//# sourceMappingURL=dollarization.js.map