import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { isCanonicalOperationId, } from "@inferock/measure/canonical-event";
import { openAiResponsesAdapter } from "@inferock/measure/provider-adapters/openai-responses";
import { anthropicAdapter, ANTHROPIC_VERSION } from "./adapters/anthropic.js";
import { geminiAdapter } from "./adapters/gemini.js";
import { openAiAdapter } from "./adapters/openai.js";
import { openRouterAdapter, openRouterEndpointEvidenceForRequest, } from "./adapters/openrouter.js";
import { acceptedBenchKeysFromConfig, applyProviderKeyUpdate, ensureReliabilityIndexAsked, providerApiKey, providerBaseUrl, } from "./config.js";
import { receiptPayload, recentCallsFromRecords, renderDashboardHtml, revealBenchKeyPayload, summaryPayload, } from "./dashboard.js";
import { createCoverageTestController, } from "./coverage-test-dashboard.js";
import { isProviderName } from "./provider.js";
import { isOpenRouterPinningError } from "./openrouter-pins.js";
import { isRecord, joinUrl, numberValue, parseJsonRecord, stringValue, } from "./record.js";
import { createStoredBenchEvent, latestStoredBenchRunId, } from "./storage.js";
import { renderLiveCounter, repriceLatencyRow, summarizeBenchEvents, } from "./summary.js";
export function createBenchKeyCallBudget(input) {
    if (!Number.isInteger(input.maxCalls) || input.maxCalls < 0) {
        throw new Error("Agent call budget maxCalls must be a non-negative integer.");
    }
    if (!Number.isInteger(input.concurrencyLimit) || input.concurrencyLimit < 1) {
        throw new Error("Agent call budget concurrencyLimit must be a positive integer.");
    }
    return {
        maxCalls: input.maxCalls,
        concurrencyLimit: input.concurrencyLimit,
        startedCalls: 0,
        completedCalls: 0,
        reservedCalls: 0,
        rejectedAttempts: 0,
        inFlight: 0,
        inFlightAtBound: 0,
    };
}
export function createBenchApp(options) {
    const app = new Hono();
    const state = { firstSuccessfulCallMeasured: false };
    let activeConfig = options.config;
    const managementAccessToken = randomBytes(32).toString("base64url");
    const coverageTest = createCoverageTestController({
        config: () => activeConfig,
        env: options.env,
        store: options.store,
        providerFetch: options.providerFetch,
        log: options.log,
        coverageTest: options.coverageTest,
        paths: options.paths,
        agentProvisioner: options.agentProvisioner,
        agentProcessRunner: options.agentProcessRunner,
    });
    const afterFirstSuccessfulCallMeasured = async () => {
        await options.onFirstSuccessfulCallMeasured?.();
        if (!options.reliabilityIndexPrompt)
            return;
        activeConfig = await ensureReliabilityIndexAsked({
            paths: options.reliabilityIndexPrompt.paths,
            config: activeConfig,
            env: options.env,
            stdinIsTty: options.reliabilityIndexPrompt.stdinIsTty,
            stdoutIsTty: options.reliabilityIndexPrompt.stdoutIsTty,
            log: options.log,
        });
    };
    const managementInput = () => ({
        config: activeConfig,
        env: options.env,
        managementAccessToken,
        allowExternalHost: options.allowExternalManagementHost ?? false,
    });
    const readInput = () => ({
        allowExternalHost: options.allowExternalManagementHost ?? false,
    });
    app.get("/", () => new Response(renderDashboardHtml({ managementAccessToken }), {
        headers: { "content-type": "text/html; charset=utf-8" },
    }));
    app.get("/health", (c) => c.json({ ok: true, service: "inferock-bench" }));
    app.get("/api/summary", async (c) => {
        const read = validLocalReadRequest(c, readInput());
        if (!read.ok)
            return localJsonError(read.status, read.code, read.message);
        const records = await options.store.readAll();
        const scope = storedEventScopeFromRequest(c, records);
        return c.json(summaryPayload({
            records,
            config: activeConfig,
            env: options.env,
            paths: options.paths,
            scope,
        }));
    });
    app.get("/api/rows", async (c) => {
        const read = validLocalReadRequest(c, readInput());
        if (!read.ok)
            return localJsonError(read.status, read.code, read.message);
        const records = await options.store.readAll();
        const summary = summarizeBenchEvents(records, storedEventScopeFromRequest(c, records), { config: activeConfig });
        return c.json({ rows: summary.rows });
    });
    app.post("/api/reprice-latency-row", async (c) => {
        const management = validManagementRequest(c, {
            config: activeConfig,
            env: options.env,
            managementAccessToken,
            allowExternalHost: options.allowExternalManagementHost ?? false,
        });
        if (!management.ok)
            return localJsonError(management.status, management.code, management.message);
        const body = parseJsonRecord(await c.req.text());
        if (!body || !isRecord(body.row)) {
            return localJsonError(400, "invalid_json", "Request body must include a row object.");
        }
        const thresholdRecord = isRecord(body.threshold) ? body.threshold : undefined;
        const rateUsdPerHour = numberValue(body.rateUsdPerHour);
        const threshold = thresholdRecord
            ? {
                acceptableStartMs: numberValue(thresholdRecord.acceptableStartMs),
                acceptableMsPerOutputToken: numberValue(thresholdRecord.acceptableMsPerOutputToken),
            }
            : undefined;
        if (thresholdRecord &&
            (threshold?.acceptableStartMs === undefined ||
                threshold.acceptableMsPerOutputToken === undefined)) {
            return localJsonError(400, "invalid_threshold", "Latency threshold edit requires numeric threshold fields.");
        }
        return c.json({
            row: repriceLatencyRow(body.row, {
                ...(threshold ? { threshold: threshold } : {}),
                ...(rateUsdPerHour !== undefined ? { rateUsdPerHour } : {}),
            }),
        });
    });
    app.get("/api/calls", async (c) => {
        const read = validLocalReadRequest(c, readInput());
        if (!read.ok)
            return localJsonError(read.status, read.code, read.message);
        const limit = callLimit(c.req.query("limit"));
        const records = await options.store.readAll();
        return c.json({
            limit,
            calls: recentCallsFromRecords(records, limit, storedEventScopeFromRequest(c, records)),
        });
    });
    app.get("/api/key", (c) => {
        const management = validManagementRequest(c, managementInput());
        if (!management.ok)
            return localJsonError(management.status, management.code, management.message);
        return new Response(`${JSON.stringify(revealBenchKeyPayload({
            config: activeConfig,
            env: options.env,
        }))}\n`, {
            headers: {
                "cache-control": "no-store",
                "content-type": "application/json; charset=utf-8",
            },
        });
    });
    app.get("/api/receipt", async (c) => {
        const read = validLocalReadRequest(c, readInput());
        if (!read.ok)
            return localJsonError(read.status, read.code, read.message);
        const records = await options.store.readAll();
        return c.json(receiptPayload({
            records,
            config: activeConfig,
            scope: storedEventScopeFromRequest(c, records),
        }));
    });
    app.get("/api/coverage-test/options", (c) => {
        const read = validLocalReadRequest(c, readInput());
        if (!read.ok)
            return localJsonError(read.status, read.code, read.message);
        return coverageTest.optionsResponse();
    });
    app.post("/api/coverage-test/estimate", (c) => {
        const management = validManagementRequest(c, managementInput());
        if (!management.ok)
            return localJsonError(management.status, management.code, management.message);
        return coverageTest.estimateResponse(c.req.raw);
    });
    app.post("/api/coverage-test/start", (c) => {
        const management = validManagementRequest(c, managementInput());
        if (!management.ok)
            return localJsonError(management.status, management.code, management.message);
        return coverageTest.startResponse(c.req.raw);
    });
    app.get("/api/coverage-test/runs", (c) => {
        const read = validLocalReadRequest(c, readInput());
        if (!read.ok)
            return localJsonError(read.status, read.code, read.message);
        return coverageTest.runsResponse();
    });
    app.get("/api/coverage-test/runs/:runId/events", (c) => {
        const read = validLocalReadRequest(c, readInput());
        if (!read.ok)
            return localJsonError(read.status, read.code, read.message);
        return coverageTest.eventsResponse(c.req.param("runId"));
    });
    app.get("/api/coverage-test/runs/:runId", (c) => {
        const read = validLocalReadRequest(c, readInput());
        if (!read.ok)
            return localJsonError(read.status, read.code, read.message);
        return coverageTest.runResponse(c.req.param("runId"));
    });
    app.post("/api/coverage-test/runs/:runId/abort", (c) => {
        const management = validManagementRequest(c, managementInput());
        if (!management.ok)
            return localJsonError(management.status, management.code, management.message);
        return coverageTest.abortResponse(c.req.param("runId"));
    });
    app.get("/api/coverage-test/runs/:runId/receipt", (c) => {
        const read = validLocalReadRequest(c, readInput());
        if (!read.ok)
            return localJsonError(read.status, read.code, read.message);
        return coverageTest.receiptResponse(c.req.param("runId"));
    });
    app.post("/api/setup", async (c) => {
        const management = validManagementRequest(c, {
            config: activeConfig,
            env: options.env,
            managementAccessToken,
            allowExternalHost: options.allowExternalManagementHost ?? false,
        });
        if (!management.ok)
            return localJsonError(management.status, management.code, management.message);
        if (!options.paths) {
            return localJsonError(503, "setup_unavailable", "Local setup persistence is unavailable.");
        }
        const body = parseJsonRecord(await c.req.text());
        if (!body) {
            return localJsonError(400, "invalid_json", "Request body must be a JSON object.");
        }
        const update = providerKeyUpdateFromBody(body);
        if (!update) {
            return localJsonError(400, "invalid_setup_payload", "Provider keys must be strings, null, or omitted.");
        }
        activeConfig = await applyProviderKeyUpdate({
            paths: options.paths,
            config: activeConfig,
            update,
        });
        const records = await options.store.readAll();
        return c.json(summaryPayload({
            records,
            config: activeConfig,
            env: options.env,
            paths: options.paths,
            scope: storedEventScopeFromRequest(c, records),
        }));
    });
    app.post("/v1/chat/completions", (c) => handleProviderRoute(c, {
        provider: "openai",
        adapter: openAiAdapter,
        canonicalRoute: "openai_chat_completions",
    }, { ...options, config: activeConfig, onFirstSuccessfulCallMeasured: afterFirstSuccessfulCallMeasured }, state));
    app.post("/v1/responses", (c) => handleProviderRoute(c, {
        provider: "openai",
        adapter: openAiResponsesAdapter,
        canonicalRoute: "openai.responses",
    }, { ...options, config: activeConfig, onFirstSuccessfulCallMeasured: afterFirstSuccessfulCallMeasured }, state));
    app.post("/v1/messages", (c) => handleProviderRoute(c, {
        provider: "anthropic",
        adapter: anthropicAdapter,
        canonicalRoute: "anthropic_messages",
    }, { ...options, config: activeConfig, onFirstSuccessfulCallMeasured: afterFirstSuccessfulCallMeasured }, state));
    app.post("/openrouter/v1/chat/completions", (c) => handleProviderRoute(c, {
        provider: "openrouter",
        adapter: openRouterAdapter,
        canonicalRoute: "openrouter_chat_completions",
    }, { ...options, config: activeConfig, onFirstSuccessfulCallMeasured: afterFirstSuccessfulCallMeasured }, state));
    app.post("/v1beta/models/:modelAndMethod", (c) => handleProviderRoute(c, {
        provider: "gemini",
        adapter: geminiAdapter,
        canonicalRoute: "gemini_generate_content",
    }, { ...options, config: activeConfig, onFirstSuccessfulCallMeasured: afterFirstSuccessfulCallMeasured }, state));
    return app;
}
async function handleProviderRoute(c, route, options, state) {
    const env = options.env ?? process.env;
    const log = options.log ?? console.log;
    if (!isProviderName(route.provider)) {
        return localJsonError(500, "invalid_provider", "Invalid local provider route.");
    }
    const acceptedBenchKey = validLocalBenchKey(c.req.raw.headers, acceptedBenchKeysFromConfig(options.config, env), options.additionalBenchKeys ?? [], route.provider, options.paths?.configFile);
    if (!acceptedBenchKey.ok) {
        return localJsonError(acceptedBenchKey.status, acceptedBenchKey.code, acceptedBenchKey.message);
    }
    const providerKey = providerApiKey(route.provider, options.config, env);
    if (!providerKey) {
        return localJsonError(503, "missing_provider_key", missingProviderKeyMessage(route.provider));
    }
    const bodyText = await c.req.text();
    const parsedBody = parseJsonRecord(bodyText);
    if (!parsedBody) {
        return localJsonError(400, "invalid_json", "Request body must be a JSON object.");
    }
    const body = requestBodyWithRouteModel(parsedBody, route, c);
    const requestModel = stringValue(body.model) ?? "unknown_model";
    const scopedModelError = scopedBenchKeyModelError(acceptedBenchKey.grant, requestModel);
    if (scopedModelError) {
        return localJsonError(scopedModelError.status, scopedModelError.code, scopedModelError.message);
    }
    const startedAt = new Date();
    const requestIdentity = requestIdentityFromHeaders(c.req.raw.headers);
    const requestId = requestIdentity.localRequestId;
    const operationId = operationIdFromHeaders(c.req.raw.headers, requestIdentity.clientOperationId);
    if (!operationId.ok) {
        return localJsonError(400, "invalid_operation_id", "Operation ID must be printable ASCII and at most 512 characters.");
    }
    const factualityAnnotation = factualityContractAnnotationFromHeaders(c.req.raw.headers);
    if (!factualityAnnotation.ok) {
        return localJsonError(400, "invalid_factuality_contract", "x-inferock-factuality-contract must be a JSON object.");
    }
    const registeredAnnotation = requestIdentity.annotationLookupId
        ? options.requestAnnotations?.annotationForRequest(requestIdentity.annotationLookupId)
        : undefined;
    const keyAnnotation = acceptedBenchKey.grant?.annotation;
    const annotation = mergeRequestAnnotations(mergeRequestAnnotations(keyAnnotation, registeredAnnotation), factualityAnnotation.annotation);
    const baseUrl = providerBaseUrl(route.provider, options.config, env);
    const apiKeyHash = providerApiKeyHash(providerKey);
    const providerFetch = options.providerFetch ?? fetch;
    let providerRequest;
    try {
        providerRequest = providerFetchRequest(route, {
            body,
            bodyText,
            providerKey,
            baseUrl,
            incomingHeaders: c.req.raw.headers,
        });
    }
    catch (error) {
        if (route.provider === "openrouter" && isOpenRouterPinningError(error)) {
            return localJsonError(400, error.code, error.message);
        }
        throw error;
    }
    const measuredRequestBody = route.provider === "openrouter"
        ? providerRequest.canonicalRequestBody ?? body
        : body;
    const budgetLease = acquireBenchKeyCallBudget(acceptedBenchKey.grant);
    if (!budgetLease.ok) {
        const endedAt = new Date();
        const responseBody = localJsonErrorBody(budgetLease.code, budgetLease.message);
        const result = route.adapter.toCanonicalEvent({
            tenantId: "local",
            requestId,
            requestModel,
            requestBody: measuredRequestBody,
            apiKeyHash,
            expectCompletion: true,
            ...canonicalAnnotationFields(annotation, operationId.value),
            route: route.canonicalRoute,
            statusCode: 429,
            requestHeaders: c.req.raw.headers,
            headers: new Headers({ "content-type": "application/json" }),
            responseBody,
            baseUrl,
            startedAt,
            endedAt,
            attemptIndex: 0,
        });
        await captureMeasuredCall(result, options, state, false, log, annotation);
        return localJsonError(429, budgetLease.code, budgetLease.message);
    }
    const providerEvidence = route.provider === "openrouter"
        ? await openRouterEndpointEvidenceForRequest({
            baseUrl,
            apiKey: providerKey,
            requestBody: measuredRequestBody,
            providerFetch,
        })
        : undefined;
    let response;
    const providerRequestStartedAt = new Date();
    try {
        response = await providerFetch(providerRequest.url, providerRequest.init);
    }
    catch {
        budgetLease.release();
        const endedAt = new Date();
        const result = route.adapter.toCanonicalEvent({
            tenantId: "local",
            requestId,
            requestModel,
            requestBody: measuredRequestBody,
            apiKeyHash,
            expectCompletion: true,
            ...canonicalAnnotationFields(annotation, operationId.value),
            route: route.canonicalRoute,
            statusCode: 502,
            requestHeaders: c.req.raw.headers,
            headers: new Headers(),
            responseBody: providerTransportErrorBody(route.provider),
            baseUrl,
            startedAt,
            endedAt,
            providerRequestStartedAt,
            attemptIndex: 0,
            ...(providerEvidence ? { providerEvidence } : {}),
        });
        await captureMeasuredCall(result, options, state, responseIsSuccessful(result.event), log, annotation);
        return localJsonError(502, "provider_transport_error", "Provider request failed before a response was received.");
    }
    const responseHeaders = passThroughHeaders(response.headers);
    if (shouldPassThroughStream(body, response)) {
        if (!response.body) {
            budgetLease.release();
            return localJsonError(502, "provider_stream_missing", "Provider stream response had no body.");
        }
        const streamInput = {
            tenantId: "local",
            requestId,
            requestModel,
            requestBody: measuredRequestBody,
            apiKeyHash,
            expectCompletion: true,
            ...canonicalAnnotationFields(annotation, operationId.value),
            route: route.canonicalRoute,
            statusCode: response.status,
            requestHeaders: c.req.raw.headers,
            headers: response.headers,
            body: response.body,
            baseUrl,
            startedAt,
            providerRequestStartedAt,
            attemptIndex: 0,
            ...(providerEvidence ? { providerEvidence } : {}),
            onTerminal: (result) => {
                void captureMeasuredCall(result, options, state, response.status < 400, log, annotation)
                    .finally(() => budgetLease.release())
                    .catch((error) => log(captureErrorMessage(error)));
            },
        };
        return new Response(route.adapter.observeStream(streamInput), {
            status: response.status,
            headers: responseHeaders,
        });
    }
    let responseBody;
    try {
        responseBody = await response.text();
    }
    catch {
        const endedAt = new Date();
        budgetLease.release();
        const result = route.adapter.toCanonicalEvent({
            tenantId: "local",
            requestId,
            requestModel,
            requestBody: measuredRequestBody,
            apiKeyHash,
            expectCompletion: true,
            ...canonicalAnnotationFields(annotation, operationId.value),
            route: route.canonicalRoute,
            statusCode: 502,
            requestHeaders: c.req.raw.headers,
            headers: response.headers,
            responseBody: providerTransportErrorBody(route.provider),
            baseUrl,
            startedAt,
            endedAt,
            providerRequestStartedAt,
            providerResponseEndedAt: endedAt,
            attemptIndex: 0,
            ...(providerEvidence ? { providerEvidence } : {}),
        });
        await captureMeasuredCall(result, options, state, false, log, annotation);
        return localJsonError(502, "provider_body_read_error", "Provider response body could not be read.");
    }
    const endedAt = new Date();
    const canonicalInput = {
        tenantId: "local",
        requestId,
        requestModel,
        requestBody: measuredRequestBody,
        apiKeyHash,
        expectCompletion: true,
        ...canonicalAnnotationFields(annotation, operationId.value),
        route: route.canonicalRoute,
        statusCode: response.status,
        requestHeaders: c.req.raw.headers,
        headers: response.headers,
        responseBody,
        baseUrl,
        startedAt,
        endedAt,
        providerRequestStartedAt,
        providerResponseEndedAt: endedAt,
        attemptIndex: 0,
        ...(providerEvidence ? { providerEvidence } : {}),
    };
    const result = route.adapter.toCanonicalEvent(canonicalInput);
    try {
        await captureMeasuredCall(result, options, state, response.status < 400, log, annotation);
    }
    finally {
        budgetLease.release();
    }
    return new Response(responseBody, {
        status: response.status,
        headers: responseHeaders,
    });
}
function providerApiKeyHash(apiKey) {
    return `sha256:${createHash("sha256").update(apiKey, "utf8").digest("hex")}`;
}
function requestBodyWithRouteModel(body, route, c) {
    if (route.provider !== "gemini" || stringValue(body.model))
        return body;
    const routeModel = geminiModelFromRoute(c.req.param("modelAndMethod"));
    return routeModel ? { ...body, model: routeModel } : body;
}
function geminiModelFromRoute(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        return undefined;
    const [model] = trimmed.split(":");
    return model ? `models/${model.replace(/^models\//, "")}` : undefined;
}
function providerFetchRequest(input, request) {
    if (input.provider === "openai" || input.provider === "gemini" || input.provider === "openrouter") {
        const adapterRequest = input.adapter.buildRequest({
            body: request.body,
            apiKey: request.providerKey,
            baseUrl: request.baseUrl,
        });
        const headers = new Headers(adapterRequest.init.headers);
        if (input.provider === "openai") {
            copyOptionalHeader(request.incomingHeaders, headers, "openai-organization");
            copyOptionalHeader(request.incomingHeaders, headers, "openai-project");
        }
        return {
            url: adapterRequest.url,
            init: {
                ...adapterRequest.init,
                headers,
                body: providerRequestBodyText(request.body, request.bodyText, adapterRequest.init.body),
            },
            ...(input.provider === "openrouter" && adapterRequest.canonicalRequestBody
                ? { canonicalRequestBody: adapterRequest.canonicalRequestBody }
                : {}),
        };
    }
    const bodyText = providerRequestBodyText(request.body, request.bodyText, JSON.stringify(withAnthropicMessagesProviderCompatibility(request.body)));
    const headers = new Headers({
        "anthropic-version": request.incomingHeaders.get("anthropic-version") ?? ANTHROPIC_VERSION,
        "content-type": "application/json",
        "x-api-key": request.providerKey,
    });
    copyOptionalHeader(request.incomingHeaders, headers, "anthropic-beta");
    return {
        url: joinUrl(request.baseUrl, "/messages"),
        init: {
            method: "POST",
            headers,
            body: bodyText,
        },
    };
}
function providerRequestBodyText(parsedBody, rawBodyText, candidateBody) {
    if (typeof candidateBody !== "string")
        return rawBodyText;
    return candidateBody === JSON.stringify(parsedBody) ? rawBodyText : candidateBody;
}
function withAnthropicMessagesProviderCompatibility(body) {
    const output = { ...body };
    delete output.response_format;
    delete output.metadata;
    // Anthropic documents unsupported temperature on Claude 4.7+/5-compatible Messages models.
    // https://docs.anthropic.com/en/api/prompt-validation
    if (isAnthropicTemperatureUnsupportedModel(stringValue(output.model)))
        delete output.temperature;
    return output;
}
function isAnthropicTemperatureUnsupportedModel(model) {
    if (!model)
        return false;
    return /^claude-[a-z]+-5(?:-|$)/.test(model) ||
        /^claude-[a-z]+-4-(?:[7-9]|\d{2,})(?:-|$)/.test(model);
}
async function captureMeasuredCall(result, options, state, successful, log, annotation) {
    await options.store.append(createStoredBenchEvent(result.event, storedEventMetadata(annotation)));
    if (successful && !state.firstSuccessfulCallMeasured) {
        state.firstSuccessfulCallMeasured = true;
        log("first call measured ✓");
        void Promise.resolve(options.onFirstSuccessfulCallMeasured?.())
            .catch((error) => log(captureErrorMessage(error)));
    }
    const summary = summarizeBenchEvents(await options.store.readAll(), annotation?.runId ? { runId: annotation.runId } : {}, { config: options.config });
    log(renderLiveCounter(summary));
}
const MANAGEMENT_ACCESS_HEADER = "x-inferock-bench-management";
function validManagementRequest(c, input) {
    if (!managementHostAndOriginAllowed(c, input.allowExternalHost)) {
        return {
            ok: false,
            status: 403,
            code: "invalid_management_origin",
            message: "Local management API requests must use the same origin as the dashboard.",
        };
    }
    const accessToken = optionalHeader(c.req.raw.headers.get(MANAGEMENT_ACCESS_HEADER));
    if (accessToken && secretEqual(accessToken, input.managementAccessToken))
        return { ok: true };
    const key = localBenchKeyFromHeaders(c.req.raw.headers);
    if (key && acceptedBenchKeysFromConfig(input.config, input.env ?? process.env).some((accepted) => secretEqual(key, accepted))) {
        return { ok: true };
    }
    return {
        ok: false,
        status: 401,
        code: "invalid_management_auth",
        message: "Local management API requests require dashboard authorization or the local bench key.",
    };
}
function validLocalReadRequest(c, input) {
    if (!managementHostAndOriginAllowed(c, input.allowExternalHost)) {
        return {
            ok: false,
            status: 403,
            code: "invalid_local_api_origin",
            message: "Local API requests must use the same origin as the dashboard.",
        };
    }
    return { ok: true };
}
function managementHostAndOriginAllowed(c, allowExternalHost) {
    const requestUrl = new URL(c.req.url);
    if (!managementHostnameAllowed(requestUrl.hostname, allowExternalHost))
        return false;
    const hostHeader = optionalHeader(c.req.raw.headers.get("host"));
    if (hostHeader) {
        const hostHeaderName = hostnameFromHostHeader(hostHeader);
        if (!hostHeaderName || !managementHostnameAllowed(hostHeaderName, allowExternalHost))
            return false;
    }
    const origin = optionalHeader(c.req.raw.headers.get("origin"));
    if (origin && !sameOrigin(origin, requestUrl))
        return false;
    const referer = optionalHeader(c.req.raw.headers.get("referer"));
    if (!origin && referer && !sameOrigin(referer, requestUrl))
        return false;
    return true;
}
function managementHostnameAllowed(hostname, allowExternalHost) {
    return allowExternalHost || loopbackHostname(hostname);
}
function loopbackHostname(hostname) {
    const normalized = normalizeHostname(hostname);
    if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1")
        return true;
    const parts = normalized.split(".");
    if (parts.length !== 4 || parts[0] !== "127")
        return false;
    return parts.every((part) => {
        const value = Number(part);
        return Number.isInteger(value) && value >= 0 && value <= 255 && String(value) === part;
    });
}
function hostnameFromHostHeader(hostHeader) {
    try {
        return new URL(`http://${hostHeader}`).hostname;
    }
    catch {
        return undefined;
    }
}
function normalizeHostname(hostname) {
    const lower = hostname.trim().toLowerCase();
    const unbracketed = lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
    return unbracketed.endsWith(".") ? unbracketed.slice(0, -1) : unbracketed;
}
function sameOrigin(candidate, requestUrl) {
    try {
        return new URL(candidate).origin === requestUrl.origin;
    }
    catch {
        return false;
    }
}
function localBenchKeyFromHeaders(headers) {
    const authorization = headers.get("authorization");
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    return optionalHeader(bearer) ?? optionalHeader(headers.get("x-api-key"));
}
function secretEqual(left, right) {
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
function validLocalBenchKey(headers, configuredKeys, additionalKeys, routeProvider, configFile) {
    const authorization = headers.get("authorization");
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const key = bearer ?? headers.get("x-api-key");
    if (!key) {
        return {
            ok: false,
            status: 401,
            code: "invalid_local_bench_key",
            message: invalidLocalBenchKeyMessage(configFile),
        };
    }
    const grant = additionalKeys.find((entry) => secretEqual(entry.key, key));
    if (grant) {
        if (grant.revokedAt) {
            return {
                ok: false,
                status: 401,
                code: "agent_bench_key_revoked",
                message: "Agent bench key was revoked for this run.",
            };
        }
        const expiresAtMs = grant.expiresAt ? Date.parse(grant.expiresAt) : undefined;
        if (expiresAtMs !== undefined && (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now())) {
            return {
                ok: false,
                status: 401,
                code: "agent_bench_key_expired",
                message: "Agent bench key expired for this run.",
            };
        }
        if (grant.provider && grant.provider !== routeProvider) {
            return {
                ok: false,
                status: 403,
                code: "agent_bench_key_provider_scope",
                message: `Agent bench key is scoped to ${grant.provider}, not ${routeProvider}.`,
            };
        }
        return { ok: true, key, grant };
    }
    if (configuredKeys.some((configuredKey) => secretEqual(configuredKey, key)))
        return { ok: true, key };
    return {
        ok: false,
        status: 401,
        code: "invalid_local_bench_key",
        message: invalidLocalBenchKeyMessage(configFile),
    };
}
function scopedBenchKeyModelError(grant, requestModel) {
    if (!grant?.models || grant.models.length === 0)
        return undefined;
    if (grant.models.includes(requestModel))
        return undefined;
    return {
        status: 403,
        code: "agent_bench_key_model_scope",
        message: `Agent bench key is scoped to model(s): ${grant.models.join(", ")}.`,
    };
}
function acquireBenchKeyCallBudget(grant) {
    const budget = grant?.callBudget;
    if (!budget && grant?.annotation.workloadClass === "coding_agent") {
        return {
            ok: false,
            code: "agent_no_active_task_budget",
            message: "Agent bench key has no active task budget; provider dispatch rejected.",
        };
    }
    if (!budget) {
        return { ok: true, release: () => undefined };
    }
    const reservedAndCompleted = budget.completedCalls + budget.reservedCalls;
    if (reservedAndCompleted >= budget.maxCalls) {
        budget.inFlightAtBound = Math.max(budget.inFlightAtBound, budget.inFlight);
        budget.rejectedAttempts += 1;
        return {
            ok: false,
            code: "agent_call_budget_exhausted",
            message: `Agent call budget exhausted before provider dispatch (${reservedAndCompleted}/${budget.maxCalls} reserved or completed).`,
        };
    }
    if (budget.inFlight >= budget.concurrencyLimit) {
        budget.rejectedAttempts += 1;
        return {
            ok: false,
            code: "agent_call_concurrency_limit",
            message: `Agent call concurrency limit reached before provider dispatch (${budget.inFlight}/${budget.concurrencyLimit} in flight).`,
        };
    }
    budget.startedCalls += 1;
    budget.inFlight += 1;
    budget.reservedCalls += 1;
    let released = false;
    return {
        ok: true,
        release: () => {
            if (released)
                return;
            released = true;
            budget.reservedCalls = Math.max(0, budget.reservedCalls - 1);
            budget.completedCalls += 1;
            budget.inFlight = Math.max(0, budget.inFlight - 1);
        },
    };
}
function storedEventScopeFromRequest(c, records) {
    if (c.req.query("scope")?.trim().toLowerCase() === "all")
        return {};
    const runId = optionalHeader(c.req.query("runId"));
    if (runId)
        return { runId };
    const latestRunId = latestStoredBenchRunId(records);
    return latestRunId ? { runId: latestRunId } : {};
}
function callLimit(value) {
    if (!value)
        return 12;
    const parsed = Number(value);
    if (!Number.isInteger(parsed))
        return 12;
    return Math.min(100, Math.max(1, parsed));
}
function providerKeyUpdateFromBody(body) {
    const update = {};
    if ("openaiApiKey" in body) {
        if (!validProviderKeyUpdate(body.openaiApiKey))
            return undefined;
        update.openaiApiKey = body.openaiApiKey;
    }
    if ("anthropicApiKey" in body) {
        if (!validProviderKeyUpdate(body.anthropicApiKey))
            return undefined;
        update.anthropicApiKey = body.anthropicApiKey;
    }
    if ("geminiApiKey" in body) {
        if (!validProviderKeyUpdate(body.geminiApiKey))
            return undefined;
        update.geminiApiKey = body.geminiApiKey;
    }
    if ("openrouterApiKey" in body) {
        if (!validProviderKeyUpdate(body.openrouterApiKey))
            return undefined;
        update.openrouterApiKey = body.openrouterApiKey;
    }
    return update;
}
function validProviderKeyUpdate(value) {
    return typeof value === "string" || value === null;
}
function invalidLocalBenchKeyMessage(configFile) {
    return configFile
        ? `Invalid local inferock-bench key. Open the dashboard or find the key in ${configFile}.`
        : "Invalid local inferock-bench key. Open the dashboard or check ~/.inferock-bench/config for the key.";
}
function requestIdentityFromHeaders(headers) {
    const extensionRequestId = optionalHeader(headers.get("x-inferock-request-id"));
    const callerRequestId = optionalHeader(headers.get("x-request-id"));
    const clientOperationId = extensionRequestId ?? callerRequestId;
    return {
        localRequestId: randomUUID(),
        ...(extensionRequestId ? { annotationLookupId: extensionRequestId } : {}),
        ...(clientOperationId ? { clientOperationId } : {}),
    };
}
function operationIdFromHeaders(headers, fallbackOperationId) {
    const value = optionalHeader(headers.get("x-inferock-operation-id")) ??
        optionalHeader(headers.get("idempotency-key")) ??
        fallbackOperationId;
    if (!value)
        return { ok: true };
    return isCanonicalOperationId(value)
        ? { ok: true, value }
        : { ok: false };
}
function optionalHeader(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
function factualityContractAnnotationFromHeaders(headers) {
    const value = optionalHeader(headers.get("x-inferock-factuality-contract"));
    if (!value)
        return { ok: true };
    const factualityContract = parseJsonRecord(value);
    return factualityContract
        ? { ok: true, annotation: { factualityContract } }
        : { ok: false };
}
function mergeRequestAnnotations(registeredAnnotation, headerAnnotation) {
    if (!registeredAnnotation)
        return headerAnnotation;
    if (!headerAnnotation)
        return registeredAnnotation;
    return {
        ...registeredAnnotation,
        ...headerAnnotation,
        factualityContract: headerAnnotation.factualityContract ?? registeredAnnotation.factualityContract,
    };
}
function canonicalAnnotationFields(annotation, operationId) {
    return {
        ...(operationId ? { operationId } : {}),
        ...(annotation?.workloadClass ? { workloadClass: annotation.workloadClass } : {}),
        ...(annotation?.outputSchemaVersion ? { outputSchemaVersion: annotation.outputSchemaVersion } : {}),
        ...(annotation?.factualityContract ? { factualityContract: annotation.factualityContract } : {}),
    };
}
function storedEventMetadata(annotation) {
    return {
        ...(annotation?.runId ? { runId: annotation.runId } : {}),
        ...(annotation?.suiteTaskId ? { suiteTaskId: annotation.suiteTaskId } : {}),
        ...(annotation?.driftCanaryProtocolVersion
            ? { driftCanaryProtocolVersion: annotation.driftCanaryProtocolVersion }
            : {}),
    };
}
function shouldPassThroughStream(body, response) {
    return body.stream === true &&
        response.body !== null &&
        (response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream");
}
function responseIsSuccessful(event) {
    if (!isRecord(event) || !isRecord(event.response))
        return false;
    const statusCode = event.response.statusCode;
    return typeof statusCode === "number" && statusCode < 400;
}
function localJsonError(status, code, message) {
    return new Response(localJsonErrorBody(code, message), {
        status,
        headers: { "content-type": "application/json" },
    });
}
function localJsonErrorBody(code, message) {
    return JSON.stringify({ error: { type: code, message } });
}
function missingProviderKeyMessage(provider) {
    switch (provider) {
        case "openai":
            return "Missing OpenAI provider key. Set INFEROCK_BENCH_OPENAI_API_KEY or OPENAI_API_KEY locally.";
        case "anthropic":
            return "Missing Anthropic provider key. Set INFEROCK_BENCH_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY locally.";
        case "gemini":
            return "Missing Gemini provider key. Set INFEROCK_BENCH_GEMINI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY locally.";
        case "openrouter":
            return "Missing OpenRouter provider key. Set INFEROCK_BENCH_OPENROUTER_API_KEY or OPENROUTER_API_KEY locally.";
        default:
            return unreachableProvider(provider);
    }
}
function providerTransportErrorBody(provider) {
    if (provider === "openai" || provider === "openrouter") {
        return JSON.stringify({
            error: {
                type: "transport_error",
                message: "Provider request failed before a response was received.",
            },
        });
    }
    return JSON.stringify({
        type: "error",
        error: {
            type: "transport_error",
            message: "Provider request failed before a response was received.",
        },
    });
}
function unreachableProvider(provider) {
    throw new Error(`Unsupported provider ${String(provider)}.`);
}
function passThroughHeaders(headers) {
    const output = new Headers();
    for (const [name, value] of headers.entries()) {
        if (isHopByHopHeader(name))
            continue;
        output.set(name, value);
    }
    return output;
}
function isHopByHopHeader(name) {
    const normalized = name.toLowerCase();
    return normalized === "connection" ||
        normalized === "content-encoding" ||
        normalized === "content-length" ||
        normalized === "keep-alive" ||
        normalized === "set-cookie" ||
        normalized === "transfer-encoding" ||
        normalized === "upgrade";
}
function copyOptionalHeader(from, to, name) {
    const value = from.get(name);
    if (value)
        to.set(name, value);
}
function captureErrorMessage(error) {
    return error instanceof Error
        ? `inferock-bench capture error: ${error.message}`
        : "inferock-bench capture error";
}
//# sourceMappingURL=proxy.js.map