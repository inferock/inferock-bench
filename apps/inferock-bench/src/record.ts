// Copied from apps/proxy/src/record.ts for inferock-bench Track C.

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function recordArray(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const records = value.filter(isRecord);
  return records.length === value.length ? records : undefined;
}

export function parseJsonRecord(text: string): JsonRecord | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

export function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  const chunks: string[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const text = stringValue(item.text);
    if (text) chunks.push(text);
  }
  return chunks.join("");
}

export function compactRecord(input: JsonRecord): JsonRecord {
  const output: JsonRecord = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value;
  }
  return output;
}

export function collectRateLimitHeaders(headers: Headers): Record<string, string> {
  const captured: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    const normalized = name.toLowerCase();
    if (
      normalized === "retry-after" ||
      normalized === "retry-after-ms" ||
      normalized === "openai-processing-ms" ||
      normalized === "x-should-retry" ||
      normalized === "x-request-id" ||
      normalized === "request-id" ||
      normalized === "openai-request-id" ||
      normalized === "anthropic-request-id" ||
      normalized.startsWith("x-ratelimit-") ||
      normalized.startsWith("anthropic-ratelimit-")
    ) {
      captured[normalized] = value;
    }
  }
  return captured;
}

export function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}
