import { readFile } from "node:fs/promises";
import { CanonicalEventAny, } from "@inferock/measure/canonical-event";
import { writePrivateTextFile } from "./private-files.js";
import { isRecord, stringValue } from "./record.js";
const ADDITIVE_TIMING_EXTENSION_FIELDS = [
    "monotonicElapsedMs",
    "monotonicClockSource",
    "wallClockDrift",
    "providerMonotonicElapsedMs",
    "providerWallClockDrift",
    "clientConsumptionEndedAt",
];
const ADDITIVE_RESPONSE_EXTENSION_FIELDS = [
    "errorOrigin",
];
const ADDITIVE_ATTEMPT_EXTENSION_FIELDS = [
    "errorOrigin",
];
export class JsonlEventStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async append(record) {
        await writePrivateTextFile(this.filePath, `${JSON.stringify(record)}\n`, { flag: "a" });
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
    const event = parseCanonicalStoredEvent(parsed.event);
    if (!event)
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
        event,
    };
}
function parseCanonicalStoredEvent(value) {
    const parsed = CanonicalEventAny.safeParse(value);
    if (parsed.success)
        return parsed.data;
    const validationShape = omitAdditiveTimingExtensions(value);
    if (validationShape === value)
        return undefined;
    const fallback = CanonicalEventAny.safeParse(validationShape);
    return fallback.success ? value : undefined;
}
function omitAdditiveTimingExtensions(value) {
    if (!isRecord(value))
        return value;
    let changed = false;
    const event = { ...value };
    if (isRecord(value.timing)) {
        event.timing = omitTimingExtensionFields(value.timing);
        changed ||= event.timing !== value.timing;
    }
    if (isRecord(value.response)) {
        event.response = omitResponseExtensionFields(value.response);
        changed ||= event.response !== value.response;
    }
    if (Array.isArray(value.attempts)) {
        const attempts = value.attempts.map((attempt) => {
            if (!isRecord(attempt))
                return attempt;
            const timing = isRecord(attempt.timing) ? omitTimingExtensionFields(attempt.timing) : attempt.timing;
            const attemptWithTiming = timing === attempt.timing ? attempt : { ...attempt, timing };
            const next = omitAttemptExtensionFields(attemptWithTiming);
            if (next === attempt)
                return attempt;
            changed = true;
            return next;
        });
        if (changed)
            event.attempts = attempts;
    }
    return changed ? event : value;
}
function omitTimingExtensionFields(timing) {
    let changed = false;
    const next = { ...timing };
    for (const field of ADDITIVE_TIMING_EXTENSION_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(next, field)) {
            delete next[field];
            changed = true;
        }
    }
    return changed ? next : timing;
}
function omitResponseExtensionFields(response) {
    let changed = false;
    const next = { ...response };
    for (const field of ADDITIVE_RESPONSE_EXTENSION_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(next, field)) {
            delete next[field];
            changed = true;
        }
    }
    return changed ? next : response;
}
function omitAttemptExtensionFields(attempt) {
    let changed = false;
    const next = { ...attempt };
    for (const field of ADDITIVE_ATTEMPT_EXTENSION_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(next, field)) {
            delete next[field];
            changed = true;
        }
    }
    return changed ? next : attempt;
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
//# sourceMappingURL=storage.js.map