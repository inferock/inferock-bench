export const CONFORMANCE_LEDGER_SCHEMA_VERSION = "inferock-real-provider-conformance-ledger-v1";
export const CONFORMANCE_MANIFEST_SCHEMA_VERSION = "inferock-real-provider-conformance-manifest-v1";
export const CONFORMANCE_SUMMARY_SCHEMA_VERSION = "inferock-real-provider-conformance-summary-v1";
export const CONFORMANCE_ARTIFACT_SUBTREE = "validation/real-provider-conformance";
export function cliModuleToConformanceModule(value) {
    return value === "stream-sse" ? "stream_sse" : "hidden_token";
}
export function validationEligibility(input = {}) {
    return {
        dashboardEligible: false,
        lossReportEligible: false,
        providerRecognizedEligible: false,
        ...(input.standardLossEligible === false ? { standardLossEligible: false } : {}),
    };
}
//# sourceMappingURL=types.js.map