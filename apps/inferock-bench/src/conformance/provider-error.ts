import type { JsonRecord } from "./types.js";

const PROVIDER_ERROR_BODY_MAX_CHARS = 2048;

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/g,
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  /\bsk-ant-[A-Za-z0-9._-]{8,}\b/g,
  /\b[A-Za-z0-9_-]*api[_-]?key[A-Za-z0-9_-]*["']?\s*[:=]\s*["']?[^"',\s}]+/gi,
];

export function sanitizedProviderErrorBody(raw: string): JsonRecord {
  const sanitized = sanitizeProviderErrorText(raw);
  const truncated = sanitized.length > PROVIDER_ERROR_BODY_MAX_CHARS;
  return {
    text: truncated ? sanitized.slice(0, PROVIDER_ERROR_BODY_MAX_CHARS) : sanitized,
    truncated,
    charLength: sanitized.length,
  };
}

export function providerErrorReason(
  statusCode: number,
  body: JsonRecord | undefined,
): string {
  const text = typeof body?.text === "string" && body.text.trim().length > 0
    ? `: ${body.text.trim()}`
    : "";
  return `provider returned HTTP ${statusCode}${text}`;
}

function sanitizeProviderErrorText(raw: string): string {
  let output = raw.replace(/\r/g, "");
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}
