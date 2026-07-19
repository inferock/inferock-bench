import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { writePrivateTextFile } from "../private-files.js";
import { CONFORMANCE_ARTIFACT_SUBTREE, CONFORMANCE_MANIFEST_SCHEMA_VERSION, CONFORMANCE_SUMMARY_SCHEMA_VERSION, } from "./types.js";
export function createConformanceArtifactWriter(input) {
    const runId = input.runId ?? generateConformanceRunId(new Date(input.createdAt ?? Date.now()));
    const runDir = join(validationConformanceRoot(input.paths.homeDir), runId);
    const rawDir = join(runDir, "raw");
    const manifest = {
        schemaVersion: CONFORMANCE_MANIFEST_SCHEMA_VERSION,
        runId,
        createdAt: input.createdAt ?? new Date().toISOString(),
        mode: input.mode,
        modules: input.modules,
        providers: input.providers,
        artifactSubtree: CONFORMANCE_ARTIFACT_SUBTREE,
        dashboardEligible: false,
        lossReportEligible: false,
        providerRecognizedEligible: false,
    };
    return {
        runId,
        runDir,
        rawDir,
        writeManifest: async () => {
            await writeJsonFile(join(runDir, "manifest.json"), manifest);
            return join(runDir, "manifest.json");
        },
        appendLedger: async (entry) => {
            assertValidationOnlyLedgerEntry(entry);
            if (entry.runId !== runId) {
                throw new Error(`Conformance ledger runId ${entry.runId} does not match writer runId ${runId}.`);
            }
            const ledgerPath = join(runDir, "ledger.jsonl");
            await writePrivateTextFile(ledgerPath, `${JSON.stringify(entry)}\n`, { flag: "a" });
            return ledgerPath;
        },
        writeSummary: async (summary) => {
            assertValidationOnlySummary(summary);
            if (summary.runId !== runId) {
                throw new Error(`Conformance summary runId ${summary.runId} does not match writer runId ${runId}.`);
            }
            const summaryPath = join(runDir, "summary.json");
            await writeJsonFile(summaryPath, summary);
            return summaryPath;
        },
        writeRawNdjson: async (probeId, rows) => {
            const path = join(rawDir, `${safeProbeFilename(probeId)}.sse.ndjson`);
            await writePrivateTextFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
            return path;
        },
        writeRawJson: async (probeId, suffix, value) => {
            const path = join(rawDir, `${safeProbeFilename(probeId)}.${suffix}.json`);
            await writeJsonFile(path, value);
            return path;
        },
        readLedgerEntries: async () => {
            const ledgerPath = join(runDir, "ledger.jsonl");
            const raw = await readFile(ledgerPath, "utf8");
            return raw.split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => JSON.parse(line));
        },
    };
}
export function validationConformanceRoot(homeDir) {
    return join(homeDir, "validation", "real-provider-conformance");
}
export function generateConformanceRunId(now = new Date(), uuid = randomUUID()) {
    const timestamp = now.toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
    return `conformance_${timestamp}_${uuid.replace(/-/g, "").slice(0, 8)}`;
}
export function emptyConformanceSummary(input) {
    return {
        schemaVersion: CONFORMANCE_SUMMARY_SCHEMA_VERSION,
        runId: input.runId,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        status: "not_run",
        moduleProviders: [],
        probeCount: 0,
        notOpenableCount: 0,
        signalCount: 0,
        inconclusiveCount: 0,
        dashboardEligible: false,
        lossReportEligible: false,
        providerRecognizedEligible: false,
    };
}
function assertValidationOnlyLedgerEntry(entry) {
    if (entry.dashboardEligible !== false ||
        entry.lossReportEligible !== false ||
        entry.providerRecognizedEligible !== false ||
        (entry.standardLossEligible !== undefined && entry.standardLossEligible !== false)) {
        throw new Error("Conformance ledger entries must be validation-only and ineligible for dashboard/loss/provider reporting.");
    }
}
function assertValidationOnlySummary(summary) {
    if (summary.schemaVersion !== CONFORMANCE_SUMMARY_SCHEMA_VERSION ||
        summary.dashboardEligible !== false ||
        summary.lossReportEligible !== false ||
        summary.providerRecognizedEligible !== false) {
        throw new Error("Conformance summary must be validation-only and use the current summary schema.");
    }
}
async function writeJsonFile(path, value) {
    await writePrivateTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
function safeProbeFilename(probeId) {
    const safe = basename(probeId).replace(/[^A-Za-z0-9_.-]/g, "_");
    if (!safe || safe === "." || safe === "..") {
        throw new Error(`Invalid conformance probe id for raw artifact path: ${probeId}`);
    }
    return safe;
}
//# sourceMappingURL=artifacts.js.map