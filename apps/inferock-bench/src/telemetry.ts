import type { BenchConfig } from "./config.js";
import { reliabilityEndpoint } from "./config.js";
import type { BenchSummary } from "./summary.js";

export interface ReliabilityFailureCount {
  readonly failureClass: string;
  readonly evidenceGrade: string;
  readonly count: number;
}

export interface ReliabilityIndexPayload {
  readonly schemaVersion: "inferock-bench-reliability-index-v1";
  readonly generatedAt: string;
  readonly period: BenchSummary["period"];
  readonly measuredCalls: number;
  readonly failureCounts: readonly ReliabilityFailureCount[];
}

export interface ReliabilitySendResult {
  readonly sent: boolean;
  readonly message: string;
  readonly payload: ReliabilityIndexPayload;
}

export function buildReliabilityIndexPayload(summary: BenchSummary): ReliabilityIndexPayload {
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

export async function sendReliabilityIndexPayload(input: {
  readonly config: BenchConfig;
  readonly summary: BenchSummary;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<ReliabilitySendResult> {
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
