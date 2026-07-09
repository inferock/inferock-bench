import type { ProviderName } from "../provider.js";
import type { ConformanceProviderSurface, JsonRecord } from "./types.js";

export type StreamTerminationCause =
  | "provider_eof_missing_terminal_marker"
  | "client_disconnected";

export interface StreamSseProbe {
  readonly probeId: string;
  readonly provider: Extract<ProviderName, "openai" | "anthropic">;
  readonly providerSurface: Extract<ConformanceProviderSurface, "openai_responses" | "chat_completions" | "anthropic_messages">;
  readonly model: string;
  readonly promptId: string;
  readonly requestBody: JsonRecord;
}

export interface StreamSseRawFrame {
  readonly observedAt: string;
  readonly event?: string;
  readonly data: string;
}

export interface StreamSseProviderCallResult {
  readonly requestId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly statusCode: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly frames: readonly StreamSseRawFrame[];
  readonly usage?: JsonRecord;
  readonly responseId?: string;
  readonly rawObjectId?: string;
  readonly content?: string;
  readonly finishReason?: string;
  readonly terminationCause?: StreamTerminationCause;
  readonly errorClass?: string;
  readonly providerErrorBody?: JsonRecord;
}

export type StreamSseProviderCall = (
  probe: StreamSseProbe,
) => Promise<StreamSseProviderCallResult>;

export function sanitizedProviderReceiptHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (!headers) return {};
  const allowed = new Set([
    "anthropic-request-id",
    "cf-ray",
    "openai-processing-ms",
    "request-id",
    "x-request-id",
  ]);
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    if (!allowed.has(normalized)) continue;
    output[normalized] = value;
  }
  return output;
}

export function providerRequestIdFromHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): string | undefined {
  if (!headers) return undefined;
  return headers["x-request-id"] ??
    headers["X-Request-Id"] ??
    headers["request-id"] ??
    headers["Request-Id"] ??
    headers["anthropic-request-id"] ??
    headers["Anthropic-Request-Id"];
}
