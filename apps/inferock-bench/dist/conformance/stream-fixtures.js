import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stableSha256 } from "../coverage-suite/canonical-json.js";
import { SseAccumulator } from "../sse.js";
import { streamSseLedgerEntry } from "./stream-sse.js";
import { validationEligibility, } from "./types.js";
export const STREAM_FIXTURE_CONTROL_DEFINITIONS = [
    {
        controlId: "missing_done",
        fileName: "missing_done.openai-chat.sse",
        expectedDetectorCode: "OPENAI_STREAM_MISSING_DONE_MARKER",
        probe: {
            probeId: "stream-fixture-missing-done-openai-chat",
            provider: "openai",
            providerSurface: "chat_completions",
            model: "fixture-openai-chat",
            promptId: "fixture-missing-done-v1",
            requestBody: {
                fixtureControl: "missing_done",
                stream: true,
                stream_options: { include_usage: true },
            },
        },
        terminationCause: "provider_eof_missing_terminal_marker",
        validationMetadata: ["synthetic_fixture_fault"],
        statusCode: 200,
        headers: { "x-request-id": "fixture-missing-done" },
        usage: { prompt_tokens: 8, completion_tokens: 2 },
    },
    {
        controlId: "client_abort",
        fileName: "client_abort.anthropic.sse",
        expectedDetectorCode: "STREAM_CLIENT_ABORTED",
        probe: {
            probeId: "stream-fixture-client-abort-anthropic",
            provider: "anthropic",
            providerSurface: "anthropic_messages",
            model: "fixture-anthropic-messages",
            promptId: "fixture-client-abort-v1",
            requestBody: {
                fixtureControl: "client_abort",
                stream: true,
            },
        },
        terminationCause: "client_disconnected",
        validationMetadata: ["synthetic_fixture_fault", "caller_owned_control"],
        statusCode: 200,
        headers: { "anthropic-request-id": "fixture-client-abort" },
        usage: { input_tokens: 8, output_tokens: 1 },
    },
    {
        controlId: "provider_stream_error",
        fileName: "provider_stream_error.anthropic.sse",
        expectedDetectorCode: "ANTHROPIC_STREAM_ERROR_EVENT",
        probe: {
            probeId: "stream-fixture-provider-stream-error-anthropic",
            provider: "anthropic",
            providerSurface: "anthropic_messages",
            model: "fixture-anthropic-messages",
            promptId: "fixture-provider-stream-error-v1",
            requestBody: {
                fixtureControl: "provider_stream_error",
                stream: true,
            },
        },
        validationMetadata: ["synthetic_fixture_fault"],
        statusCode: 200,
        headers: { "anthropic-request-id": "fixture-provider-stream-error" },
        usage: { input_tokens: 8, output_tokens: 0 },
    },
    {
        controlId: "terminal_status_gap",
        fileName: "terminal_status_gap.openai-responses.sse",
        expectedDetectorCode: "STREAM_TERMINAL_STATUS_GAP",
        probe: {
            probeId: "stream-fixture-terminal-status-gap-openai-responses",
            provider: "openai",
            providerSurface: "openai_responses",
            model: "fixture-openai-responses",
            promptId: "fixture-terminal-status-gap-v1",
            requestBody: {
                fixtureControl: "terminal_status_gap",
                stream: true,
            },
        },
        validationMetadata: ["synthetic_fixture_fault"],
        statusCode: 200,
        headers: { "x-request-id": "fixture-terminal-status-gap" },
        usage: { input_tokens: 8, output_tokens: 1 },
    },
];
export async function runStreamFixtureControls(input) {
    const fixtureDir = input.fixtureDir ?? fileURLToPath(new URL("./__fixtures__/stream", import.meta.url));
    const entries = [];
    for (const definition of STREAM_FIXTURE_CONTROL_DEFINITIONS) {
        const frames = parseFixtureSse(await readFile(join(fixtureDir, definition.fileName), "utf8"));
        const result = {
            requestId: `${definition.probe.probeId}-request`,
            startedAt: "2026-07-08T12:00:00.000Z",
            endedAt: "2026-07-08T12:00:01.000Z",
            statusCode: definition.statusCode,
            headers: definition.headers,
            frames,
            usage: definition.usage,
            ...(definition.terminationCause ? { terminationCause: definition.terminationCause } : {}),
        };
        const baseEntry = streamSseLedgerEntry({
            runId: input.runId,
            probe: definition.probe,
            result,
        });
        const entry = {
            ...baseEntry,
            mode: "fixture_control",
            validationMetadata: definition.validationMetadata,
            ...validationEligibility({ standardLossEligible: false }),
            rawEvidence: {
                ...baseEntry.rawEvidence,
                fixtureControl: definition.controlId,
                expectedDetectorCode: definition.expectedDetectorCode,
                syntheticProviderAttribution: false,
            },
            detectors: {
                ...baseEntry.detectors,
                fixtureControl: definition.controlId,
                expectedDetectorCode: definition.expectedDetectorCode,
                syntheticProviderAttribution: false,
            },
        };
        if (input.writer) {
            await input.writer.writeRawNdjson(definition.probe.probeId, fixtureRawRows(definition.controlId, frames));
            await input.writer.writeRawJson(definition.probe.probeId, "usage", definition.usage);
            await input.writer.appendLedger(entry);
        }
        entries.push(entry);
    }
    return { entries };
}
export function parseFixtureSse(raw) {
    const accumulator = new SseAccumulator();
    const messages = [...accumulator.push(raw), ...accumulator.end()];
    return messages.map((message, index) => ({
        observedAt: new Date(Date.parse("2026-07-08T12:00:00.100Z") + index * 150).toISOString(),
        ...(message.event ? { event: message.event } : {}),
        data: message.data,
    }));
}
function fixtureRawRows(controlId, frames) {
    return frames.map((frame, index) => ({
        index,
        fixtureControl: controlId,
        observedAt: frame.observedAt,
        eventType: frame.event ?? "message",
        dataHash: stableSha256({ data: frame.data }),
        terminalMarker: frame.data === "[DONE]" ||
            frame.event === "response.completed" ||
            frame.event === "response.incomplete" ||
            frame.event === "response.failed" ||
            frame.event === "message_stop" ||
            frame.event === "error",
    }));
}
//# sourceMappingURL=stream-fixtures.js.map