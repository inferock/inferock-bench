import { createHash, createHmac } from "node:crypto";
import { REQUEST_SECRET_DIGEST_ALGORITHM, SECURITY_SECRET_PATTERN_VERSION, findSecuritySecretMatches, requestSecretDigestPayload, } from "./security-secrets.js";
import { providerSafetyForEvent } from "./signal.js";
export const SECURITY_SIGNAL_CODES = [
    "SECURITY_SECRET_EXACT_MATCH",
    "SECURITY_PROVIDER_SAFETY_FIELD",
];
const DETECTOR_NAME = "security-governance";
const DETECTOR_VERSION = "v0";
/**
 * Runs v0 security/governance detectors over output-only canonical fields.
 */
export function runSecurityDetectors(event, options = {}) {
    const signals = new Map();
    const detectorEvent = event;
    for (const signal of secretSignalsForSurfaces(detectorEvent, outputTextSurfaces(event), options)) {
        addSignal(signals, signal);
    }
    providerSafetyForEvent(event).forEach((entry, index) => {
        addSignal(signals, providerSafetySignal(event, entry, index));
    });
    return [...signals.values()];
}
export function spanHashForSecurityFinding(span) {
    return createHash("sha256").update(span).digest("hex");
}
function secretSignalsForSurfaces(event, surfaces, options) {
    const signals = [];
    for (const match of findSecuritySecretMatches(surfaces)) {
        const spanHash = spanHashForSecurityFinding(match.span);
        const attribution = attributionForSecret(event, match, options);
        signals.push(buildSecuritySignal(event, {
            code: "SECURITY_SECRET_EXACT_MATCH",
            fieldPath: match.fieldPath,
            category: match.category,
            spanHash,
            evidence: {
                reason: "secret_exact_match",
                kind: "secret",
                span_hash: spanHash,
                fieldPath: match.fieldPath,
                category: match.category,
                confidence: "high",
                attribution,
            },
            valueJson: {
                matchLength: match.matchLength,
                attribution,
            },
        }));
    }
    return signals;
}
function providerSafetySignal(event, entry, index) {
    const fieldPath = providerSafetyFieldPath(entry, index);
    const source = entry.source ?? "provider";
    const spanHash = spanHashForSecurityFinding([
        "provider_safety_field",
        source,
        entry.kind,
        entry.reason ?? "",
        fieldPath,
    ].join("\n"));
    return buildSecuritySignal(event, {
        code: "SECURITY_PROVIDER_SAFETY_FIELD",
        fieldPath,
        category: entry.kind,
        spanHash,
        evidence: {
            reason: "provider_safety_field",
            kind: entry.kind,
            source,
            span_hash: spanHash,
            fieldPath,
            category: entry.kind,
            confidence: "high",
            ...(entry.reason ? { providerReason: entry.reason } : {}),
            ...providerSafetyMetadata(entry),
        },
        valueJson: {
            providerSafetyIndex: index,
            ...providerSafetyMetadata(entry),
        },
    });
}
function buildSecuritySignal(event, input) {
    return {
        code: input.code,
        detectorName: DETECTOR_NAME,
        detectorVersion: DETECTOR_VERSION,
        tenantId: event.request.tenantId,
        requestId: event.request.requestId,
        provider: event.request.provider,
        model: event.request.model,
        status: "triage_only",
        evidenceGrade: "triage_only",
        dispute: false,
        liabilityParty: "unknown",
        creditCandidate: false,
        fieldPath: input.fieldPath,
        category: input.category,
        spanHash: input.spanHash,
        evidence: input.evidence,
        valueJson: input.valueJson,
    };
}
function outputTextSurfaces(event) {
    return [
        ...(event.response.content.length > 0
            ? [{ text: event.response.content, fieldPath: "response.content" }]
            : []),
        ...(event.response.toolCalls ?? []).flatMap((toolCall, index) => stringLeaves(toolCall, `response.toolCalls[${index}]`)),
    ];
}
function stringLeaves(value, fieldPath) {
    if (typeof value === "string" && value.length > 0) {
        return [{ text: value, fieldPath }];
    }
    if (Array.isArray(value)) {
        return value.flatMap((item, index) => stringLeaves(item, `${fieldPath}[${index}]`));
    }
    if (!isRecord(value))
        return [];
    return Object.entries(value).flatMap(([key, item]) => stringLeaves(item, `${fieldPath}${fieldPathSegment(key)}`));
}
function fieldPathSegment(key) {
    return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}
function providerSafetyFieldPath(entry, index) {
    if (isRecord(entry.raw) && typeof entry.raw.fieldPath === "string" && entry.raw.fieldPath.length > 0) {
        return entry.raw.fieldPath;
    }
    return `response.providerSafety[${index}]`;
}
function addSignal(signals, signal) {
    const key = `${signal.code}:${signal.fieldPath}:${signal.spanHash}`;
    if (!signals.has(key))
        signals.set(key, signal);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function attributionForSecret(event, match, options) {
    const context = event.request.securityContext;
    const base = {
        mode: "request_secret_digest_match_v1",
        rawRequestStored: false,
    };
    if (!context) {
        return {
            ...base,
            result: "unknown_request_context_not_captured",
            requestMatchCount: 0,
            matchedRequestFieldPaths: [],
        };
    }
    if (context.truncated || !context.captureComplete) {
        return {
            ...base,
            result: "unknown_request_digest_truncated",
            requestMatchCount: 0,
            matchedRequestFieldPaths: [],
            digestKeyId: context.digestKeyId,
            captureComplete: context.captureComplete,
            truncated: context.truncated,
        };
    }
    const matchingCategoryDigests = context.requestSecretDigests
        .filter((requestDigest) => requestDigest.category === match.category);
    const patternVersions = uniqueStrings(matchingCategoryDigests.map(requestDigestPatternVersion));
    const mismatchedPatternVersions = patternVersions.filter((version) => version !== match.patternVersion);
    if (mismatchedPatternVersions.length > 0) {
        return {
            ...base,
            result: "unknown_request_digest_pattern_version_mismatch",
            reason: "request_secret_digest_pattern_version_mismatch",
            metric: "security_request_secret_digest_pattern_version_mismatch",
            requestMatchCount: 0,
            matchedRequestFieldPaths: [],
            digestKeyId: context.digestKeyId,
            detectorPatternVersion: SECURITY_SECRET_PATTERN_VERSION,
            expectedPatternVersion: match.patternVersion,
            requestPatternVersions: patternVersions,
            mismatchedPatternVersions,
            patternVersionMismatch: true,
            captureComplete: context.captureComplete,
            truncated: context.truncated,
        };
    }
    const digestKey = requestSecretDigestKeys(options).find((key) => key.keyId === context.digestKeyId);
    if (!digestKey) {
        return {
            ...base,
            result: "unknown_digest_key_unavailable",
            requestMatchCount: 0,
            matchedRequestFieldPaths: [],
            digestKeyId: context.digestKeyId,
        };
    }
    const digest = requestSecretDigest(event, digestKey, match.category, match.span, match.patternVersion);
    const matches = matchingCategoryDigests.filter((requestDigest) => requestDigestPatternVersion(requestDigest) === match.patternVersion && requestDigest.digest === digest);
    if (matches.length > 0) {
        return {
            ...base,
            result: "carried_in_request_context",
            requestMatchCount: matches.length,
            matchedRequestFieldPaths: uniqueStrings(matches.map((requestDigest) => requestDigest.fieldPath)),
            matchedRequestDigestPrefixes: uniqueStrings(matches.map((requestDigest) => requestDigest.digest.slice(0, 24))),
            digestKeyId: context.digestKeyId,
        };
    }
    return {
        ...base,
        result: "provider_attributable_candidate",
        requestMatchCount: 0,
        matchedRequestFieldPaths: [],
        digestKeyId: context.digestKeyId,
    };
}
function requestSecretDigestKeys(options) {
    if (options.requestSecretDigestKeys)
        return options.requestSecretDigestKeys;
    const keyId = process.env.REQUEST_SECRET_DIGEST_KEY_ID;
    const key = process.env.REQUEST_SECRET_DIGEST_KEY;
    return keyId && key ? [{ keyId, key }] : [];
}
function requestSecretDigest(event, digestKey, category, span, patternVersion) {
    const attemptIndex = event.request.attemptIndex ?? event.meta.attemptIndex;
    const digest = createHmac("sha256", digestKey.key)
        .update(requestSecretDigestPayload({
        tenantId: event.request.tenantId,
        requestId: event.request.requestId,
        attemptIndex,
        patternVersion,
        category,
        span,
    }), "utf8")
        .digest("hex");
    return `${REQUEST_SECRET_DIGEST_ALGORITHM}:${digestKey.keyId}:${digest}`;
}
function providerSafetyMetadata(entry) {
    if (entry.kind !== "moderation" || !isRecord(entry.raw))
        return {};
    return {
        moderation: sanitizedModerationEvidence(entry.raw),
    };
}
function sanitizedModerationEvidence(raw) {
    return {
        ...copyString(raw, "fieldPath"),
        ...copyString(raw, "provider"),
        ...copyString(raw, "scope"),
        ...copyString(raw, "model"),
        ...copyString(raw, "type"),
        ...copyString(raw, "code"),
        ...copyBoolean(raw, "flagged"),
        ...copyNumber(raw, "resultIndex"),
        ...copyNumber(raw, "choiceIndex"),
        ...(stringArray(raw.categories) ? { categories: stringArray(raw.categories) } : {}),
        ...(numberRecord(raw.categoryScores) ? { categoryScores: numberRecord(raw.categoryScores) } : {}),
    };
}
function requestDigestPatternVersion(input) {
    return typeof input.patternVersion === "string" && input.patternVersion.length > 0
        ? input.patternVersion
        : "unknown";
}
function copyString(record, key) {
    const value = record[key];
    return typeof value === "string" && value.length > 0 ? { [key]: value } : {};
}
function copyBoolean(record, key) {
    const value = record[key];
    return typeof value === "boolean" ? { [key]: value } : {};
}
function copyNumber(record, key) {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? { [key]: value } : {};
}
function stringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    const strings = value.filter((item) => typeof item === "string" && item.length > 0);
    return strings.length > 0 ? strings : undefined;
}
function numberRecord(value) {
    if (!isRecord(value))
        return undefined;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === "number" && Number.isFinite(item))
            output[key] = item;
    }
    return Object.keys(output).length > 0 ? output : undefined;
}
function uniqueStrings(values) {
    return [...new Set(values)].sort();
}
//# sourceMappingURL=security.js.map