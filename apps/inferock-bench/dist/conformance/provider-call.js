export function sanitizedProviderReceiptHeaders(headers) {
    if (!headers)
        return {};
    const allowed = new Set([
        "anthropic-request-id",
        "cf-ray",
        "openai-processing-ms",
        "request-id",
        "x-request-id",
    ]);
    const output = {};
    for (const [key, value] of Object.entries(headers)) {
        const normalized = key.toLowerCase();
        if (!allowed.has(normalized))
            continue;
        output[normalized] = value;
    }
    return output;
}
export function providerRequestIdFromHeaders(headers) {
    if (!headers)
        return undefined;
    return headers["x-request-id"] ??
        headers["X-Request-Id"] ??
        headers["request-id"] ??
        headers["Request-Id"] ??
        headers["anthropic-request-id"] ??
        headers["Anthropic-Request-Id"];
}
//# sourceMappingURL=provider-call.js.map