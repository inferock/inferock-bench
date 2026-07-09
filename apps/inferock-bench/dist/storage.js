import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CanonicalEventAny, } from "@inferock/measure/canonical-event";
import { isRecord, stringValue } from "./record.js";
export class JsonlEventStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async append(record) {
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, `${JSON.stringify(record)}\n`, {
            encoding: "utf8",
            flag: "a",
        });
    }
    async readAll() {
        let raw;
        try {
            raw = await readFile(this.filePath, "utf8");
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ENOENT")
                return [];
            throw error;
        }
        const records = [];
        for (const line of raw.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            const parsed = parseStoredBenchEvent(trimmed);
            if (parsed)
                records.push(parsed);
        }
        return records;
    }
}
export function createStoredBenchEvent(event, metadata = {}) {
    const runId = stringValue(metadata.runId);
    const suiteTaskId = stringValue(metadata.suiteTaskId);
    const driftCanaryProtocolVersion = stringValue(metadata.driftCanaryProtocolVersion);
    return {
        schemaVersion: "inferock-bench-event-v1",
        capturedAt: new Date().toISOString(),
        ...(runId ? { runId } : {}),
        ...(suiteTaskId ? { suiteTaskId } : {}),
        ...(driftCanaryProtocolVersion ? { driftCanaryProtocolVersion } : {}),
        event,
    };
}
export function summarizeStoredBenchEventScope(records, runId) {
    return records.filter((record) => record.runId === runId);
}
export function selectStoredBenchEvents(records, scope = {}) {
    return scope.runId
        ? summarizeStoredBenchEventScope(records, scope.runId)
        : [...records];
}
export function latestStoredBenchRunId(records) {
    let latest;
    records.forEach((record, index) => {
        if (!record.runId)
            return;
        const capturedAtMs = Date.parse(record.capturedAt);
        const comparableCapturedAtMs = Number.isFinite(capturedAtMs) ? capturedAtMs : 0;
        if (!latest ||
            comparableCapturedAtMs > latest.capturedAtMs ||
            (comparableCapturedAtMs === latest.capturedAtMs && index > latest.index)) {
            latest = { runId: record.runId, capturedAtMs: comparableCapturedAtMs, index };
        }
    });
    return latest?.runId;
}
export function parseStoredBenchEventLine(line) {
    return parseStoredBenchEvent(line);
}
function parseStoredBenchEvent(line) {
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch {
        return undefined;
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== "inferock-bench-event-v1")
        return undefined;
    const capturedAt = stringValue(parsed.capturedAt);
    if (!capturedAt)
        return undefined;
    const event = CanonicalEventAny.safeParse(parsed.event);
    if (!event.success)
        return undefined;
    const runId = stringValue(parsed.runId);
    const suiteTaskId = stringValue(parsed.suiteTaskId);
    const driftCanaryProtocolVersion = stringValue(parsed.driftCanaryProtocolVersion);
    return {
        schemaVersion: "inferock-bench-event-v1",
        capturedAt,
        ...(runId ? { runId } : {}),
        ...(suiteTaskId ? { suiteTaskId } : {}),
        ...(driftCanaryProtocolVersion ? { driftCanaryProtocolVersion } : {}),
        event: event.data,
    };
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
//# sourceMappingURL=storage.js.map