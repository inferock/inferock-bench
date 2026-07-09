import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  CanonicalEventAny,
  type CanonicalEventAny as CanonicalEventAnyType,
} from "@inferock/measure/canonical-event";
import { isRecord, stringValue } from "./record.js";

export interface StoredBenchEvent {
  readonly schemaVersion: "inferock-bench-event-v1";
  readonly capturedAt: string;
  readonly runId?: string;
  readonly suiteTaskId?: string;
  readonly driftCanaryProtocolVersion?: string;
  readonly event: CanonicalEventAnyType;
}

export interface StoredBenchEventMetadata {
  readonly runId?: string;
  readonly suiteTaskId?: string;
  readonly driftCanaryProtocolVersion?: string;
}

export interface StoredBenchEventScope {
  readonly runId?: string;
}

export interface EventStore {
  append(record: StoredBenchEvent): Promise<void>;
  readAll(): Promise<StoredBenchEvent[]>;
}

export class JsonlEventStore implements EventStore {
  constructor(private readonly filePath: string) {}

  async append(record: StoredBenchEvent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      flag: "a",
    });
  }

  async readAll(): Promise<StoredBenchEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }

    const records: StoredBenchEvent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = parseStoredBenchEvent(trimmed);
      if (parsed) records.push(parsed);
    }
    return records;
  }
}

export function createStoredBenchEvent(
  event: CanonicalEventAnyType,
  metadata: StoredBenchEventMetadata = {},
): StoredBenchEvent {
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

export function summarizeStoredBenchEventScope(
  records: readonly StoredBenchEvent[],
  runId: string,
): StoredBenchEvent[] {
  return records.filter((record) => record.runId === runId);
}

export function selectStoredBenchEvents(
  records: readonly StoredBenchEvent[],
  scope: StoredBenchEventScope = {},
): StoredBenchEvent[] {
  return scope.runId
    ? summarizeStoredBenchEventScope(records, scope.runId)
    : [...records];
}

export function latestStoredBenchRunId(records: readonly StoredBenchEvent[]): string | undefined {
  let latest: { readonly runId: string; readonly capturedAtMs: number; readonly index: number } | undefined;
  records.forEach((record, index) => {
    if (!record.runId) return;
    const capturedAtMs = Date.parse(record.capturedAt);
    const comparableCapturedAtMs = Number.isFinite(capturedAtMs) ? capturedAtMs : 0;
    if (
      !latest ||
      comparableCapturedAtMs > latest.capturedAtMs ||
      (comparableCapturedAtMs === latest.capturedAtMs && index > latest.index)
    ) {
      latest = { runId: record.runId, capturedAtMs: comparableCapturedAtMs, index };
    }
  });
  return latest?.runId;
}

export function parseStoredBenchEventLine(line: string): StoredBenchEvent | undefined {
  return parseStoredBenchEvent(line);
}

function parseStoredBenchEvent(line: string): StoredBenchEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== "inferock-bench-event-v1") return undefined;
  const capturedAt = stringValue(parsed.capturedAt);
  if (!capturedAt) return undefined;
  const event = CanonicalEventAny.safeParse(parsed.event);
  if (!event.success) return undefined;
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
