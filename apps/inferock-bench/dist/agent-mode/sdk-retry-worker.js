import { isRecord, stringValue } from "../record.js";
import { redactAgentLogLine } from "./redaction.js";
export async function runSdkRetryWorker(input) {
    const before = await input.store.readAll();
    try {
        if (input.provider === "openai") {
            await runOpenAiSdkProbe(input);
        }
        else {
            await runAnthropicSdkProbe(input);
        }
    }
    catch (error) {
        input.log?.(redactAgentLogLine(`sdk retry worker did not produce native evidence: ${errorMessage(error)}`));
    }
    const after = await input.store.readAll();
    const newRecords = after.slice(before.length)
        .filter((record) => record.runId === input.runId);
    const evidenceObserved = newRecords.some(hasSdkRetryObservation);
    return {
        callsLaunched: newRecords.length,
        evidenceObserved,
        status: evidenceObserved ? "completed" : "not_openable",
        ...(evidenceObserved
            ? {}
            : { notOpenableReason: `official ${input.provider} SDK did not emit native retry metadata` }),
    };
}
async function runOpenAiSdkProbe(input) {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({
        apiKey: input.localKey,
        baseURL: `${input.proxyBaseUrl.replace(/\/$/, "")}/v1`,
        maxRetries: 2,
        defaultHeaders: {
            "x-inferock-operation-id": `${input.runId}:sdk-retry-worker`,
            "x-inferock-request-origin": "sdk_retry_probe",
        },
    });
    await client.chat.completions.create({
        model: input.model,
        max_tokens: 16,
        messages: [{
                role: "user",
                content: "Refresh the local receipt index once and reply with a short status.",
            }],
    });
}
async function runAnthropicSdkProbe(input) {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({
        apiKey: input.localKey,
        baseURL: input.proxyBaseUrl.replace(/\/$/, ""),
        maxRetries: 2,
        defaultHeaders: {
            "x-inferock-operation-id": `${input.runId}:sdk-retry-worker`,
            "x-inferock-request-origin": "sdk_retry_probe",
        },
    });
    await client.messages.create({
        model: input.model,
        max_tokens: 16,
        messages: [{
                role: "user",
                content: "Refresh the local receipt index once and reply with a short status.",
            }],
    });
}
function hasSdkRetryObservation(record) {
    const event = record.event;
    if (headerValue(asRecord(event.request)?.sanitizedHeaders, "x-stainless-retry-count") !== undefined)
        return true;
    if (headerValue(asRecord(event.response)?.sanitizedHeaders, "x-stainless-retry-count") !== undefined)
        return true;
    const eventRecord = asRecord(event);
    const rawAttempts = eventRecord?.attempts;
    const attempts = Array.isArray(rawAttempts) ? rawAttempts : [];
    return attempts.some((attempt) => {
        const attemptRecord = asRecord(attempt);
        return stringValue(attemptRecord?.status) === "retry" ||
            stringValue(attemptRecord?.retryReason) !== undefined ||
            attemptRecord?.finalSelected === false ||
            headerValue(attemptRecord?.sanitizedHeaders, "x-stainless-retry-count") !== undefined;
    });
}
function headerValue(value, name) {
    const headers = asRecord(value);
    if (!headers)
        return undefined;
    const normalized = name.toLowerCase();
    for (const [key, header] of Object.entries(headers)) {
        if (key.toLowerCase() === normalized)
            return stringValue(header);
    }
    return undefined;
}
function asRecord(value) {
    return isRecord(value) ? value : undefined;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=sdk-retry-worker.js.map