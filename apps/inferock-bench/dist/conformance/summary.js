import { CONFORMANCE_SUMMARY_SCHEMA_VERSION, } from "./types.js";
export function summarizeConformanceLedger(input) {
    assertHiddenPositiveCoverageHonesty(input.entries);
    const moduleProviders = moduleProviderSummaries(input.entries);
    return {
        schemaVersion: CONFORMANCE_SUMMARY_SCHEMA_VERSION,
        runId: input.runId,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        status: aggregateSummaryStatus(moduleProviders),
        moduleProviders,
        probeCount: input.entries.length,
        notOpenableCount: input.entries.filter((entry) => entry.openability.status === "not_openable").length,
        signalCount: input.entries.filter((entry) => entry.openability.status === "signal" || entry.status === "signal").length,
        inconclusiveCount: input.entries.filter((entry) => entry.status === "inconclusive").length,
        dashboardEligible: false,
        lossReportEligible: false,
        providerRecognizedEligible: false,
    };
}
export function renderConformanceSummary(input) {
    const rows = input.summary.moduleProviders.map((row) => {
        const labels = input.entries
            .filter((entry) => entry.module === row.module && entry.provider === row.provider)
            .map(renderEntryCoverageLabel);
        return [
            `${row.module}/${row.provider}: ${formatStatus(row.status)}`,
            `  probes=${row.probeCount} not-openable=${row.notOpenableCount} signals=${row.signalCount} inconclusive=${row.inconclusiveCount}`,
            ...labels.map((label) => `  - ${label}`),
        ].join("\n");
    });
    return [
        "inferock-bench conformance summary",
        `run: ${input.summary.runId}`,
        `status: ${formatStatus(input.summary.status)}`,
        `probes: ${input.summary.probeCount}`,
        `not-openable: ${input.summary.notOpenableCount}`,
        `signals: ${input.summary.signalCount}`,
        `inconclusive: ${input.summary.inconclusiveCount}`,
        ...rows,
    ].join("\n");
}
export function assertHiddenPositiveCoverageHonesty(entries) {
    for (const entry of entries) {
        if (entry.module !== "hidden_token" ||
            entry.providerSurface === "hidden_token_negative_control" ||
            entry.openability.status !== "watched_clean")
            continue;
        const hiddenTokens = numericEvidence(entry.rawEvidence.recognizedHiddenOutputTokens);
        if (hiddenTokens <= 0) {
            throw new Error(`Hidden-token positive probe ${entry.probeId} cannot be watched-clean without recognized hidden output tokens.`);
        }
    }
}
function moduleProviderSummaries(entries) {
    const groups = new Map();
    for (const entry of entries) {
        const key = `${entry.module}:${entry.provider}`;
        groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, group]) => {
        const first = group[0];
        return {
            module: first.module,
            provider: first.provider,
            status: aggregateEntryStatus(group),
            probeCount: group.length,
            notOpenableCount: group.filter((entry) => entry.openability.status === "not_openable").length,
            signalCount: group.filter((entry) => entry.openability.status === "signal" || entry.status === "signal").length,
            inconclusiveCount: group.filter((entry) => entry.status === "inconclusive").length,
        };
    });
}
function aggregateSummaryStatus(rows) {
    if (rows.length === 0)
        return "not_run";
    if (rows.some((row) => row.status === "signal"))
        return "signal";
    if (rows.some((row) => row.status === "inconclusive"))
        return "inconclusive";
    if (rows.some((row) => row.status === "not_openable"))
        return "not_openable";
    if (rows.every((row) => row.status === "not_applicable"))
        return "not_applicable";
    return "watched_clean";
}
function aggregateEntryStatus(entries) {
    if (entries.length === 0)
        return "not_run";
    if (entries.some((entry) => entry.openability.status === "signal" || entry.status === "signal"))
        return "signal";
    if (entries.some((entry) => entry.status === "inconclusive"))
        return "inconclusive";
    if (entries.some((entry) => entry.openability.status === "not_openable"))
        return "not_openable";
    if (entries.every((entry) => entry.openability.status === "not_applicable"))
        return "not_applicable";
    return "watched_clean";
}
function renderEntryCoverageLabel(entry) {
    if (entry.openability.label)
        return entry.openability.label;
    if (entry.openability.status === "not_openable") {
        return `not-openable: ${entry.openability.reason ?? "surface precondition not carried"}`;
    }
    if (entry.openability.status === "signal")
        return "signal: conformance anomaly found";
    if (entry.openability.status === "not_applicable")
        return "not-applicable";
    return "watched-clean";
}
function formatStatus(status) {
    return status.replaceAll("_", "-");
}
function numericEvidence(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
//# sourceMappingURL=summary.js.map