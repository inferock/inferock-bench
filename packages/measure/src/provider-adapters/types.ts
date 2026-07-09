import type { CanonicalAttemptRecord, CanonicalEventV2, ProviderName } from "../canonical-event.js";
import type { JsonRecord } from "./record.js";

export interface ProviderFetchRequest {
  readonly url: string;
  readonly init: RequestInit;
}

export interface RequestSecretDigestConfig {
  readonly digestKey: string;
  readonly digestKeyId: string;
}

export interface AdapterBuildRequestInput {
  readonly body: JsonRecord;
  readonly apiKey: string;
  readonly baseUrl: string;
}

export interface AdapterCanonicalInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly requestModel: string;
  readonly requestBody: JsonRecord;
  readonly apiKeyHash?: string;
  readonly expectCompletion?: boolean;
  readonly retryCorrelationId?: string;
  readonly operationId?: string;
  readonly route?: string;
  readonly workloadClass?: string;
  readonly outputSchemaVersion?: string;
  readonly factualityContract?: JsonRecord;
  readonly requestSecretDigestConfig?: RequestSecretDigestConfig;
  readonly baseUrl?: string;
  readonly statusCode: number;
  readonly requestHeaders?: Headers;
  readonly headers: Headers;
  readonly responseBody: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly providerRequestStartedAt?: Date;
  readonly providerResponseEndedAt?: Date;
  readonly attemptIndex: number;
  readonly previousAttempts?: readonly CanonicalAttemptRecord[];
}

export interface AdapterStreamInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly requestModel: string;
  readonly requestBody: JsonRecord;
  readonly apiKeyHash?: string;
  readonly expectCompletion?: boolean;
  readonly retryCorrelationId?: string;
  readonly operationId?: string;
  readonly route?: string;
  readonly workloadClass?: string;
  readonly outputSchemaVersion?: string;
  readonly factualityContract?: JsonRecord;
  readonly requestSecretDigestConfig?: RequestSecretDigestConfig;
  readonly baseUrl?: string;
  readonly statusCode: number;
  readonly requestHeaders?: Headers;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array>;
  readonly startedAt: Date;
  readonly providerRequestStartedAt?: Date;
  readonly providerResponseEndedAt?: Date;
  readonly attemptIndex: number;
  readonly previousAttempts?: readonly CanonicalAttemptRecord[];
  readonly onTerminal: (result: AdapterCanonicalResult) => void;
}

export interface AdapterCanonicalResult {
  readonly event: CanonicalEventV2;
  readonly rateLimitHeaders: Record<string, string>;
}

export interface ProviderAdapter {
  readonly provider: ProviderName;
  buildRequest(input: AdapterBuildRequestInput): ProviderFetchRequest;
  toCanonicalEvent(input: AdapterCanonicalInput): AdapterCanonicalResult;
  observeStream(input: AdapterStreamInput): ReadableStream<Uint8Array>;
}
