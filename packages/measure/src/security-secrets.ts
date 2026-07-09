export const SECURITY_SECRET_PATTERN_VERSION = "security-governance:v0" as const;
export const REQUEST_SECRET_DIGEST_CAPTURE_VERSION = "request_secret_digest_v1" as const;
export const REQUEST_SECRET_DIGEST_ALGORITHM = "hmac-sha256" as const;
export const REQUEST_SECRET_DIGEST_SCOPE = "event" as const;
export const REQUEST_SECRET_DIGEST_MAX_PER_EVENT = 32;
export const REQUEST_SECRET_FIELD_PATH_MAX_LENGTH = 512;
export const REQUEST_SECRET_DIGEST_KEY_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

export interface TextSurface {
  readonly text: string;
  readonly fieldPath: string;
}

export interface SecuritySecretMatch extends TextSurface {
  readonly category: string;
  readonly span: string;
  readonly matchLength: number;
  readonly patternVersion: typeof SECURITY_SECRET_PATTERN_VERSION;
}

interface SecretPattern {
  readonly category: string;
  readonly source: string;
  readonly prefixPattern: RegExp;
}

const MIN_SECRET_BODY_LENGTH = 32;
const MIN_SECRET_UNIQUE_CHARS = 12;
const MIN_SECRET_ENTROPY = 3.2;

const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    category: "openai_api_key",
    source: String.raw`\bsk-proj-[A-Za-z0-9_-]{48,}\b`,
    prefixPattern: /^sk-proj-/,
  },
  {
    category: "openai_service_account_key",
    source: String.raw`\bsk-svcacct-[A-Za-z0-9_-]{48,}\b`,
    prefixPattern: /^sk-svcacct-/,
  },
  {
    category: "anthropic_api_key",
    source: String.raw`\bsk-ant-api03-[A-Za-z0-9_-]{48,}\b`,
    prefixPattern: /^sk-ant-api03-/,
  },
  {
    category: "github_personal_access_token",
    source: String.raw`\bghp_[A-Za-z0-9]{36}\b`,
    prefixPattern: /^ghp_/,
  },
];

const PLACEHOLDER_SECRET_PATTERN =
  /(example|placeholder|dummy|redacted|sample|changeme|your[-_]?key|x{8,}|0{16,}|1{16,})/i;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7E]+$/;

export function findSecuritySecretMatches(
  surfaces: readonly TextSurface[],
): SecuritySecretMatch[] {
  const matches: SecuritySecretMatch[] = [];
  for (const surface of surfaces) {
    for (const secretPattern of SECRET_PATTERNS) {
      const pattern = new RegExp(secretPattern.source, "g");
      for (const match of surface.text.matchAll(pattern)) {
        const span = match[0];
        if (!isHighPrecisionSecuritySecret(span, secretPattern)) continue;
        matches.push({
          text: surface.text,
          fieldPath: surface.fieldPath,
          category: secretPattern.category,
          span,
          matchLength: span.length,
          patternVersion: SECURITY_SECRET_PATTERN_VERSION,
        });
      }
    }
  }
  return matches;
}

export function findSecuritySecretMatchesInValue(
  value: unknown,
  rootFieldPath: string,
): SecuritySecretMatch[] {
  return findSecuritySecretMatches(stringLeaves(value, rootFieldPath));
}

export function requestSecretDigestPayload(input: {
  readonly tenantId: string;
  readonly requestId: string;
  readonly attemptIndex: number;
  readonly patternVersion: string;
  readonly category: string;
  readonly span: string;
}): string {
  return JSON.stringify([
    REQUEST_SECRET_DIGEST_CAPTURE_VERSION,
    input.patternVersion,
    input.tenantId,
    input.requestId,
    input.attemptIndex,
    input.category,
    input.span,
  ]);
}

export function isRequestSecretDigestKeyId(value: string): boolean {
  return REQUEST_SECRET_DIGEST_KEY_ID_PATTERN.test(value);
}

function stringLeaves(value: unknown, fieldPath: string): TextSurface[] {
  if (fieldPath.length > REQUEST_SECRET_FIELD_PATH_MAX_LENGTH) return [];
  if (typeof value === "string" && value.length > 0) {
    return [{ text: value, fieldPath }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => stringLeaves(item, `${fieldPath}[${index}]`));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    stringLeaves(item, `${fieldPath}${fieldPathSegment(key)}`)
  );
}

function fieldPathSegment(key: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return `.${key}`;
  const printableKey = printableAscii(JSON.stringify(key));
  return `[${printableKey}]`;
}

function printableAscii(value: string): string {
  return [...value]
    .map((character) => PRINTABLE_ASCII_PATTERN.test(character) ? character : "?")
    .join("");
}

function isHighPrecisionSecuritySecret(span: string, pattern: SecretPattern): boolean {
  if (PLACEHOLDER_SECRET_PATTERN.test(span)) return false;
  const body = span.replace(pattern.prefixPattern, "");
  if (body.length < MIN_SECRET_BODY_LENGTH) return false;
  if (uniqueCharacterCount(body) < MIN_SECRET_UNIQUE_CHARS) return false;
  if (shannonEntropy(body) < MIN_SECRET_ENTROPY) return false;
  return !/(.)\1{12,}/.test(body);
}

function uniqueCharacterCount(value: string): number {
  return new Set(value).size;
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
