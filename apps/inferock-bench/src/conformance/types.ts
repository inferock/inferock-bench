import type { ProviderName } from "../provider.js";

export const CONFORMANCE_LEDGER_SCHEMA_VERSION = "inferock-real-provider-conformance-ledger-v1";
export const CONFORMANCE_MANIFEST_SCHEMA_VERSION = "inferock-real-provider-conformance-manifest-v1";
export const CONFORMANCE_SUMMARY_SCHEMA_VERSION = "inferock-real-provider-conformance-summary-v1";
export const CONFORMANCE_ARTIFACT_SUBTREE = "validation/real-provider-conformance";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonRecord = { readonly [key: string]: JsonValue };

export type ConformanceModule = "stream_sse" | "hidden_token";
export type ConformanceCliModule = "stream-sse" | "hidden-token";
export type ConformanceMode = "real_provider" | "fixture_control";
export type ConformanceProviderSurface =
  | "openai_responses"
  | "chat_completions"
  | "anthropic_messages"
  | "fixture_sse"
  | "hidden_token_negative_control";

export type ConformanceProbeStatus =
  | "passed"
  | "signal"
  | "inconclusive"
  | "not_openable"
  | "not_applicable"
  | "not_run_spend_cap"
  | "pricing_unknown"
  | "failed";

export type ConformanceSurfaceStatus =
  | "watched_clean"
  | "signal"
  | "not_openable"
  | "not_applicable";

export interface ConformanceOpenability {
  readonly surfaceOpened: boolean;
  readonly status: ConformanceSurfaceStatus;
  readonly reason?: string;
  readonly label?: string;
  readonly watchedEvidence?: JsonRecord;
}

export interface ConformanceRequestEvidence {
  readonly bodyHash: string;
  readonly promptId: string;
  readonly syntheticContentOnly: true;
}

export interface ConformanceEligibility {
  readonly dashboardEligible: false;
  readonly lossReportEligible: false;
  readonly providerRecognizedEligible: false;
  readonly standardLossEligible?: false;
}

export interface ConformanceLedgerEntry extends ConformanceEligibility {
  readonly schemaVersion: typeof CONFORMANCE_LEDGER_SCHEMA_VERSION;
  readonly runId: string;
  readonly probeId: string;
  readonly module: ConformanceModule;
  readonly mode: ConformanceMode;
  readonly provider: ProviderName;
  readonly providerSurface: ConformanceProviderSurface;
  readonly model: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly status: ConformanceProbeStatus;
  readonly openability: ConformanceOpenability;
  readonly validationMetadata: readonly string[];
  readonly request: ConformanceRequestEvidence;
  readonly rawEvidence: JsonRecord;
  readonly canonical: JsonRecord;
  readonly detectors: JsonRecord;
}

export interface ConformanceManifest {
  readonly schemaVersion: typeof CONFORMANCE_MANIFEST_SCHEMA_VERSION;
  readonly runId: string;
  readonly createdAt: string;
  readonly mode: ConformanceMode;
  readonly modules: readonly ConformanceModule[];
  readonly providers: readonly ProviderName[];
  readonly artifactSubtree: typeof CONFORMANCE_ARTIFACT_SUBTREE;
  readonly dashboardEligible: false;
  readonly lossReportEligible: false;
  readonly providerRecognizedEligible: false;
}

export interface ConformanceSummaryModuleProvider {
  readonly module: ConformanceModule;
  readonly provider: ProviderName;
  readonly status: ConformanceSurfaceStatus | "inconclusive" | "not_run";
  readonly probeCount: number;
  readonly notOpenableCount: number;
  readonly signalCount: number;
  readonly inconclusiveCount: number;
}

export interface ConformanceSummary {
  readonly schemaVersion: typeof CONFORMANCE_SUMMARY_SCHEMA_VERSION;
  readonly runId: string;
  readonly generatedAt: string;
  readonly status: ConformanceSurfaceStatus | "inconclusive" | "not_run";
  readonly moduleProviders: readonly ConformanceSummaryModuleProvider[];
  readonly probeCount: number;
  readonly notOpenableCount: number;
  readonly signalCount: number;
  readonly inconclusiveCount: number;
  readonly dashboardEligible: false;
  readonly lossReportEligible: false;
  readonly providerRecognizedEligible: false;
}

export function cliModuleToConformanceModule(value: ConformanceCliModule): ConformanceModule {
  return value === "stream-sse" ? "stream_sse" : "hidden_token";
}

export function validationEligibility(input: {
  readonly standardLossEligible?: false;
} = {}): ConformanceEligibility {
  return {
    dashboardEligible: false,
    lossReportEligible: false,
    providerRecognizedEligible: false,
    ...(input.standardLossEligible === false ? { standardLossEligible: false } : {}),
  };
}
