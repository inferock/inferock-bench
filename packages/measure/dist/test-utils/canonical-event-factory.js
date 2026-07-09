export function buildCanonicalEvent(overrides = {}) {
    const base = {
        request: {
            tenantId: "tenant-test",
            provider: "openai",
            model: "gpt-5-mini",
            requestId: "req-test",
            expectCompletion: true,
        },
        response: {
            statusCode: 200,
            finishReason: "stop",
            content: "completed",
        },
        usage: {
            input: 100,
            output: 10,
            cache: {
                read: 0,
                creation: 0,
            },
        },
        timing: {
            startedAt: "2026-06-14T12:00:00.000Z",
            endedAt: "2026-06-14T12:00:01.000Z",
            latencyMs: 1_000,
        },
        meta: {
            attemptIndex: 0,
            schemaVersion: "v1",
        },
    };
    return {
        request: { ...base.request, ...overrides.request },
        response: { ...base.response, ...overrides.response },
        usage: {
            ...base.usage,
            ...overrides.usage,
            cache: overrides.usage?.cache === undefined
                ? base.usage.cache
                : { ...base.usage.cache, ...overrides.usage.cache },
        },
        timing: { ...base.timing, ...overrides.timing },
        meta: { ...base.meta, ...overrides.meta },
    };
}
//# sourceMappingURL=canonical-event-factory.js.map