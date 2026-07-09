export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function asRecord(value) {
    return isRecord(value) ? value : undefined;
}
export function stringValue(value) {
    return typeof value === "string" ? value : undefined;
}
export function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
}
export function booleanValue(value) {
    return typeof value === "boolean" ? value : undefined;
}
export function recordArray(value) {
    if (!Array.isArray(value))
        return undefined;
    const records = value.filter(isRecord);
    return records.length === value.length ? records : undefined;
}
export function parseJsonRecord(text) {
    try {
        const parsed = JSON.parse(text);
        return asRecord(parsed);
    }
    catch {
        return undefined;
    }
}
export function textFromContent(value) {
    if (typeof value === "string")
        return value;
    if (!Array.isArray(value))
        return "";
    const chunks = [];
    for (const item of value) {
        if (!isRecord(item))
            continue;
        const text = stringValue(item.text);
        if (text)
            chunks.push(text);
    }
    return chunks.join("");
}
export function compactRecord(input) {
    const output = {};
    for (const [key, value] of Object.entries(input)) {
        if (value !== undefined)
            output[key] = value;
    }
    return output;
}
export function collectRateLimitHeaders(headers) {
    const captured = {};
    for (const [name, value] of headers.entries()) {
        const normalized = name.toLowerCase();
        if (normalized === "retry-after" ||
            normalized === "retry-after-ms" ||
            normalized === "openai-processing-ms" ||
            normalized === "x-should-retry" ||
            normalized === "x-request-id" ||
            normalized === "request-id" ||
            normalized === "openai-request-id" ||
            normalized === "anthropic-request-id" ||
            normalized.startsWith("x-ratelimit-") ||
            normalized.startsWith("anthropic-ratelimit-")) {
            captured[normalized] = value;
        }
    }
    return captured;
}
export function joinUrl(baseUrl, path) {
    return baseUrl.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}
//# sourceMappingURL=record.js.map