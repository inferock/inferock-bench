import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  isCanonicalOperationId,
  type CanonicalEventAny,
} from "@inferock/measure/canonical-event";
import { openAiResponsesAdapter } from "@inferock/measure/provider-adapters/openai-responses";
import { anthropicAdapter, ANTHROPIC_VERSION } from "./adapters/anthropic.js";
import { geminiAdapter } from "./adapters/gemini.js";
import { openAiAdapter } from "./adapters/openai.js";
import {
  openRouterAdapter,
  openRouterEndpointEvidenceForRequest,
} from "./adapters/openrouter.js";
import type {
  AdapterCanonicalInput,
  AdapterCanonicalResult,
  AdapterStreamInput,
  ProviderAdapter,
  ProviderFetchRequest,
} from "./adapters/types.js";
import {
  acceptedBenchKeysFromConfig,
  applyProviderKeyUpdate,
  ensureReliabilityIndexAsked,
  type BenchConfig,
  type BenchPaths,
  type ProviderKeyUpdate,
  providerApiKey,
  providerBaseUrl,
} from "./config.js";
import {
  receiptPayload,
  recentCallsFromRecords,
  renderDashboardHtml,
  revealBenchKeyPayload,
  summaryPayload,
} from "./dashboard.js";
import {
  createCoverageTestController,
  type CoverageTestRuntimeOverrides,
} from "./coverage-test-dashboard.js";
import type { ProviderParallelRunInput } from "./coverage-suite/provider-parallel-runner.js";
import type { AgentProcessRunner } from "./coverage-suite/agent-runner.js";
import type { ProviderName } from "./provider.js";
import { isProviderName } from "./provider.js";
import { isOpenRouterPinningError } from "./openrouter-pins.js";
import {
  isRecord,
  joinUrl,
  numberValue,
  parseJsonRecord,
  stringValue,
  type JsonRecord,
} from "./record.js";
import {
  createStoredBenchEvent,
  latestStoredBenchRunId,
  type EventStore,
  type StoredBenchEvent,
  type StoredBenchEventScope,
} from "./storage.js";
import {
  renderLiveCounter,
  repriceLatencyRow,
  summarizeBenchEvents,
  type ReportRow,
} from "./summary.js";
import type {
  BenchRequestAnnotation,
  BenchRequestAnnotationSource,
} from "./coverage-suite/runner-annotations.js";

export type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface BenchKeyCallBudget {
  readonly maxCalls: number;
  readonly concurrencyLimit: number;
  startedCalls: number;
  completedCalls: number;
  reservedCalls: number;
  rejectedAttempts: number;
  inFlight: number;
  inFlightAtBound: number;
}

export interface AdditionalBenchKeyGrant {
  readonly key: string;
  readonly annotation: BenchRequestAnnotation;
  readonly provider?: ProviderName;
  readonly models?: readonly string[];
  readonly expiresAt?: string;
  revokedAt?: string;
  callBudget?: BenchKeyCallBudget;
}

export interface BenchProxyOptions {
  readonly config: BenchConfig;
  readonly paths?: BenchPaths;
  readonly store: EventStore;
  readonly env?: NodeJS.ProcessEnv;
  readonly providerFetch?: ProviderFetch;
  readonly log?: (line: string) => void;
  readonly reliabilityIndexPrompt?: ReliabilityPromptOptions;
  readonly onFirstSuccessfulCallMeasured?: () => void | Promise<void>;
  readonly requestAnnotations?: BenchRequestAnnotationSource;
  readonly additionalBenchKeys?: readonly AdditionalBenchKeyGrant[];
  readonly coverageTest?: CoverageTestRuntimeOverrides;
  readonly agentProvisioner?: ProviderParallelRunInput["agentProvisioner"];
  readonly agentProcessRunner?: AgentProcessRunner;
}

interface ProxyState {
  firstSuccessfulCallMeasured: boolean;
}

interface ReliabilityPromptOptions {
  readonly paths: BenchPaths;
  readonly stdinIsTty?: boolean;
  readonly stdoutIsTty?: boolean;
}

interface ProviderRoute {
  readonly provider: ProviderName;
  readonly adapter: ProviderAdapter;
  readonly canonicalRoute:
    | "openai_chat_completions"
    | "openrouter_chat_completions"
    | "anthropic_messages"
    | "openai.responses"
    | "gemini_generate_content";
}

export function createBenchKeyCallBudget(input: {
  readonly maxCalls: number;
  readonly concurrencyLimit: number;
}): BenchKeyCallBudget {
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

export function createBenchApp(options: BenchProxyOptions): Hono {
  const app = new Hono();
  const state: ProxyState = { firstSuccessfulCallMeasured: false };
  let activeConfig = options.config;
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
  const afterFirstSuccessfulCallMeasured = async (): Promise<void> => {
    await options.onFirstSuccessfulCallMeasured?.();
    if (!options.reliabilityIndexPrompt) return;
    activeConfig = await ensureReliabilityIndexAsked({
      paths: options.reliabilityIndexPrompt.paths,
      config: activeConfig,
      env: options.env,
      stdinIsTty: options.reliabilityIndexPrompt.stdinIsTty,
      stdoutIsTty: options.reliabilityIndexPrompt.stdoutIsTty,
      log: options.log,
    });
  };

  app.get("/", () => new Response(renderDashboardHtml(), {
    headers: { "content-type": "text/html; charset=utf-8" },
  }));
  app.get("/health", (c) => c.json({ ok: true, service: "inferock-bench" }));
  app.get("/api/summary", async (c) => {
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
    const records = await options.store.readAll();
    const summary = summarizeBenchEvents(records, storedEventScopeFromRequest(c, records), { config: activeConfig });
    return c.json({ rows: summary.rows });
  });
  app.post("/api/reprice-latency-row", async (c) => {
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
    if (
      thresholdRecord &&
      (threshold?.acceptableStartMs === undefined ||
        threshold.acceptableMsPerOutputToken === undefined)
    ) {
      return localJsonError(400, "invalid_threshold", "Latency threshold edit requires numeric threshold fields.");
    }
    return c.json({
      row: repriceLatencyRow(body.row as unknown as ReportRow, {
        ...(threshold ? { threshold: threshold as { acceptableStartMs: number; acceptableMsPerOutputToken: number } } : {}),
        ...(rateUsdPerHour !== undefined ? { rateUsdPerHour } : {}),
      }),
    });
  });
  app.get("/api/calls", async (c) => {
    const limit = callLimit(c.req.query("limit"));
    const records = await options.store.readAll();
    return c.json({
      limit,
      calls: recentCallsFromRecords(records, limit, storedEventScopeFromRequest(c, records)),
    });
  });
  app.get("/api/key", () => new Response(
    `${JSON.stringify(revealBenchKeyPayload({
      config: activeConfig,
      env: options.env,
    }))}\n`,
    {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
    },
  ));
  app.get("/api/receipt", async (c) => {
    const records = await options.store.readAll();
    return c.json(receiptPayload({
      records,
      config: activeConfig,
      scope: storedEventScopeFromRequest(c, records),
    }));
  });
  app.get("/api/coverage-test/options", () => coverageTest.optionsResponse());
  app.post("/api/coverage-test/estimate", (c) => coverageTest.estimateResponse(c.req.raw));
  app.post("/api/coverage-test/start", (c) => coverageTest.startResponse(c.req.raw));
  app.get("/api/coverage-test/runs", () => coverageTest.runsResponse());
  app.get("/api/coverage-test/runs/:runId/events", (c) =>
    coverageTest.eventsResponse(c.req.param("runId")));
  app.get("/api/coverage-test/runs/:runId", (c) =>
    coverageTest.runResponse(c.req.param("runId")));
  app.post("/api/coverage-test/runs/:runId/abort", (c) =>
    coverageTest.abortResponse(c.req.param("runId")));
  app.get("/api/coverage-test/runs/:runId/receipt", (c) =>
    coverageTest.receiptResponse(c.req.param("runId")));
  app.post("/api/setup", async (c) => {
    if (!options.paths) {
      return localJsonError(503, "setup_unavailable", "Local setup persistence is unavailable.");
    }

    const body = parseJsonRecord(await c.req.text());
    if (!body) {
      return localJsonError(400, "invalid_json", "Request body must be a JSON object.");
    }

    const update = providerKeyUpdateFromBody(body);
    if (!update) {
      return localJsonError(
        400,
        "invalid_setup_payload",
        "Provider keys must be strings, null, or omitted.",
      );
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

  app.post("/v1/chat/completions", (c) =>
    handleProviderRoute(c, {
      provider: "openai",
      adapter: openAiAdapter,
      canonicalRoute: "openai_chat_completions",
    }, { ...options, config: activeConfig, onFirstSuccessfulCallMeasured: afterFirstSuccessfulCallMeasured }, state));

  app.post("/v1/responses", (c) =>
    handleProviderRoute(c, {
      provider: "openai",
      adapter: openAiResponsesAdapter as ProviderAdapter,
      canonicalRoute: "openai.responses",
    }, { ...options, config: activeConfig, onFirstSuccessfulCallMeasured: afterFirstSuccessfulCallMeasured }, state));

  app.post("/v1/messages", (c) =>
    handleProviderRoute(c, {
      provider: "anthropic",
      adapter: anthropicAdapter,
      canonicalRoute: "anthropic_messages",
    }, { ...options, config: activeConfig, onFirstSuccessfulCallMeasured: afterFirstSuccessfulCallMeasured }, state));

  app.post("/openrouter/v1/chat/completions", (c) =>
    handleProviderRoute(c, {
      provider: "openrouter",
      adapter: openRouterAdapter,
      canonicalRoute: "openrouter_chat_completions",
    }, { ...options, config: activeConfig, onFirstSuccessfulCallMeasured: afterFirstSuccessfulCallMeasured }, state));

  app.post("/v1beta/models/:modelAndMethod", (c) =>
    handleProviderRoute(c, {
      provider: "gemini",
      adapter: geminiAdapter,
      canonicalRoute: "gemini_generate_content",
    }, { ...options, config: activeConfig, onFirstSuccessfulCallMeasured: afterFirstSuccessfulCallMeasured }, state));

  return app;
}

async function handleProviderRoute(
  c: Context,
  route: ProviderRoute,
  options: BenchProxyOptions,
  state: ProxyState,
): Promise<Response> {
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  if (!isProviderName(route.provider)) {
    return localJsonError(500, "invalid_provider", "Invalid local provider route.");
  }
  const acceptedBenchKey = validLocalBenchKey(
    c.req.raw.headers,
    acceptedBenchKeysFromConfig(options.config, env),
    options.additionalBenchKeys ?? [],
    route.provider,
    options.paths?.configFile,
  );
  if (!acceptedBenchKey.ok) {
    return localJsonError(acceptedBenchKey.status, acceptedBenchKey.code, acceptedBenchKey.message);
  }

  const providerKey = providerApiKey(route.provider, options.config, env);
  if (!providerKey) {
    return localJsonError(
      503,
      "missing_provider_key",
      missingProviderKeyMessage(route.provider),
    );
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
  const annotation = mergeRequestAnnotations(
    mergeRequestAnnotations(keyAnnotation, registeredAnnotation),
    factualityAnnotation.annotation,
  );
  const baseUrl = providerBaseUrl(route.provider, options.config, env);
  const apiKeyHash = providerApiKeyHash(providerKey);
  const providerFetch = options.providerFetch ?? fetch;
  let providerRequest: ProviderFetchRequest;
  try {
    providerRequest = providerFetchRequest(route, {
      body,
      bodyText,
      providerKey,
      baseUrl,
      incomingHeaders: c.req.raw.headers,
    });
  } catch (error) {
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

  let response: Response;
  const providerRequestStartedAt = new Date();
  try {
    response = await providerFetch(providerRequest.url, providerRequest.init);
  } catch {
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

    const streamInput: AdapterStreamInput = {
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
          .catch((error: unknown) => log(captureErrorMessage(error)));
      },
    };
    return new Response(route.adapter.observeStream(streamInput), {
      status: response.status,
      headers: responseHeaders,
    });
  }

  const responseBody = await response.text();
  const endedAt = new Date();
  const canonicalInput: AdapterCanonicalInput = {
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
  } finally {
    budgetLease.release();
  }
  return new Response(responseBody, {
    status: response.status,
    headers: responseHeaders,
  });
}

function providerApiKeyHash(apiKey: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(apiKey, "utf8").digest("hex")}`;
}

function requestBodyWithRouteModel(body: JsonRecord, route: ProviderRoute, c: Context): JsonRecord {
  if (route.provider !== "gemini" || stringValue(body.model)) return body;
  const routeModel = geminiModelFromRoute(c.req.param("modelAndMethod"));
  return routeModel ? { ...body, model: routeModel } : body;
}

function geminiModelFromRoute(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const [model] = trimmed.split(":");
  return model ? `models/${model.replace(/^models\//, "")}` : undefined;
}

function providerFetchRequest(input: ProviderRoute, request: {
  readonly body: JsonRecord;
  readonly bodyText: string;
  readonly providerKey: string;
  readonly baseUrl: string;
  readonly incomingHeaders: Headers;
}): ProviderFetchRequest {
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

  const bodyText = providerRequestBodyText(
    request.body,
    request.bodyText,
    JSON.stringify(withAnthropicMessagesProviderCompatibility(request.body)),
  );
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

function providerRequestBodyText(
  parsedBody: JsonRecord,
  rawBodyText: string,
  candidateBody: RequestInit["body"],
): string {
  if (typeof candidateBody !== "string") return rawBodyText;
  return candidateBody === JSON.stringify(parsedBody) ? rawBodyText : candidateBody;
}

function withAnthropicMessagesProviderCompatibility(body: JsonRecord): JsonRecord {
  const output = { ...body };
  delete output.response_format;
  delete output.metadata;
  // Anthropic documents unsupported temperature on Claude 4.7+/5-compatible Messages models.
  // https://docs.anthropic.com/en/api/prompt-validation
  if (isAnthropicTemperatureUnsupportedModel(stringValue(output.model))) delete output.temperature;
  return output;
}

function isAnthropicTemperatureUnsupportedModel(model: string | undefined): boolean {
  if (!model) return false;
  return /^claude-[a-z]+-5(?:-|$)/.test(model) ||
    /^claude-[a-z]+-4-(?:[7-9]|\d{2,})(?:-|$)/.test(model);
}

async function captureMeasuredCall(
  result: AdapterCanonicalResult,
  options: BenchProxyOptions,
  state: ProxyState,
  successful: boolean,
  log: (line: string) => void,
  annotation: BenchRequestAnnotation | undefined,
): Promise<void> {
  await options.store.append(createStoredBenchEvent(result.event, storedEventMetadata(annotation)));
  if (successful && !state.firstSuccessfulCallMeasured) {
    state.firstSuccessfulCallMeasured = true;
    log("first call measured ✓");
    void Promise.resolve(options.onFirstSuccessfulCallMeasured?.())
      .catch((error: unknown) => log(captureErrorMessage(error)));
  }
  const summary = summarizeBenchEvents(
    await options.store.readAll(),
    annotation?.runId ? { runId: annotation.runId } : {},
    { config: options.config },
  );
  log(renderLiveCounter(summary));
}

type LocalBenchKeyValidation =
  | { readonly ok: true; readonly key: string; readonly grant?: AdditionalBenchKeyGrant }
  | { readonly ok: false; readonly status: 401 | 403; readonly code: string; readonly message: string };

function validLocalBenchKey(
  headers: Headers,
  configuredKeys: readonly string[],
  additionalKeys: readonly AdditionalBenchKeyGrant[],
  routeProvider: ProviderName,
  configFile: string | undefined,
): LocalBenchKeyValidation {
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

  const grant = additionalKeys.find((entry) => entry.key === key);
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

  if (configuredKeys.includes(key)) return { ok: true, key };

  return {
    ok: false,
    status: 401,
    code: "invalid_local_bench_key",
    message: invalidLocalBenchKeyMessage(configFile),
  };
}

function scopedBenchKeyModelError(
  grant: AdditionalBenchKeyGrant | undefined,
  requestModel: string,
): { readonly status: 403; readonly code: string; readonly message: string } | undefined {
  if (!grant?.models || grant.models.length === 0) return undefined;
  if (grant.models.includes(requestModel)) return undefined;
  return {
    status: 403,
    code: "agent_bench_key_model_scope",
    message: `Agent bench key is scoped to model(s): ${grant.models.join(", ")}.`,
  };
}

type BenchKeyCallBudgetLease =
  | { readonly ok: true; release(): void }
  | { readonly ok: false; readonly code: string; readonly message: string };

function acquireBenchKeyCallBudget(grant: AdditionalBenchKeyGrant | undefined): BenchKeyCallBudgetLease {
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
      if (released) return;
      released = true;
      budget.reservedCalls = Math.max(0, budget.reservedCalls - 1);
      budget.completedCalls += 1;
      budget.inFlight = Math.max(0, budget.inFlight - 1);
    },
  };
}

function storedEventScopeFromRequest(
  c: Context,
  records: readonly StoredBenchEvent[],
): StoredBenchEventScope {
  if (c.req.query("scope")?.trim().toLowerCase() === "all") return {};
  const runId = optionalHeader(c.req.query("runId"));
  if (runId) return { runId };
  const latestRunId = latestStoredBenchRunId(records);
  return latestRunId ? { runId: latestRunId } : {};
}

function callLimit(value: string | undefined): number {
  if (!value) return 12;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 12;
  return Math.min(100, Math.max(1, parsed));
}

function providerKeyUpdateFromBody(body: JsonRecord): ProviderKeyUpdate | undefined {
  const update: {
    openaiApiKey?: string | null;
    anthropicApiKey?: string | null;
    geminiApiKey?: string | null;
    openrouterApiKey?: string | null;
  } = {};

  if ("openaiApiKey" in body) {
    if (!validProviderKeyUpdate(body.openaiApiKey)) return undefined;
    update.openaiApiKey = body.openaiApiKey;
  }

  if ("anthropicApiKey" in body) {
    if (!validProviderKeyUpdate(body.anthropicApiKey)) return undefined;
    update.anthropicApiKey = body.anthropicApiKey;
  }

  if ("geminiApiKey" in body) {
    if (!validProviderKeyUpdate(body.geminiApiKey)) return undefined;
    update.geminiApiKey = body.geminiApiKey;
  }

  if ("openrouterApiKey" in body) {
    if (!validProviderKeyUpdate(body.openrouterApiKey)) return undefined;
    update.openrouterApiKey = body.openrouterApiKey;
  }

  return update;
}

function validProviderKeyUpdate(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function invalidLocalBenchKeyMessage(configFile: string | undefined): string {
  return configFile
    ? `Invalid local inferock-bench key. Open the dashboard or find the key in ${configFile}.`
    : "Invalid local inferock-bench key. Open the dashboard or check ~/.inferock-bench/config for the key.";
}

interface RequestIdentity {
  readonly localRequestId: string;
  readonly annotationLookupId?: string;
  readonly clientOperationId?: string;
}

function requestIdentityFromHeaders(headers: Headers): RequestIdentity {
  const extensionRequestId = optionalHeader(headers.get("x-inferock-request-id"));
  const callerRequestId = optionalHeader(headers.get("x-request-id"));
  const clientOperationId = extensionRequestId ?? callerRequestId;
  return {
    localRequestId: randomUUID(),
    ...(extensionRequestId ? { annotationLookupId: extensionRequestId } : {}),
    ...(clientOperationId ? { clientOperationId } : {}),
  };
}

function operationIdFromHeaders(headers: Headers, fallbackOperationId: string | undefined):
  | { readonly ok: true; readonly value?: string }
  | { readonly ok: false } {
  const value = optionalHeader(headers.get("x-inferock-operation-id")) ??
    optionalHeader(headers.get("idempotency-key")) ??
    fallbackOperationId;
  if (!value) return { ok: true };
  return isCanonicalOperationId(value)
    ? { ok: true, value }
    : { ok: false };
}

function optionalHeader(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function factualityContractAnnotationFromHeaders(headers: Headers):
  | { readonly ok: true; readonly annotation?: BenchRequestAnnotation }
  | { readonly ok: false } {
  const value = optionalHeader(headers.get("x-inferock-factuality-contract"));
  if (!value) return { ok: true };
  const factualityContract = parseJsonRecord(value);
  return factualityContract
    ? { ok: true, annotation: { factualityContract } }
    : { ok: false };
}

function mergeRequestAnnotations(
  registeredAnnotation: BenchRequestAnnotation | undefined,
  headerAnnotation: BenchRequestAnnotation | undefined,
): BenchRequestAnnotation | undefined {
  if (!registeredAnnotation) return headerAnnotation;
  if (!headerAnnotation) return registeredAnnotation;
  return {
    ...registeredAnnotation,
    ...headerAnnotation,
    factualityContract: headerAnnotation.factualityContract ?? registeredAnnotation.factualityContract,
  };
}

function canonicalAnnotationFields(
  annotation: BenchRequestAnnotation | undefined,
  operationId: string | undefined,
): Partial<AdapterCanonicalInput> {
  return {
    ...(operationId ? { operationId } : {}),
    ...(annotation?.workloadClass ? { workloadClass: annotation.workloadClass } : {}),
    ...(annotation?.outputSchemaVersion ? { outputSchemaVersion: annotation.outputSchemaVersion } : {}),
    ...(annotation?.factualityContract ? { factualityContract: annotation.factualityContract } : {}),
  };
}

function storedEventMetadata(
  annotation: BenchRequestAnnotation | undefined,
): { readonly runId?: string; readonly suiteTaskId?: string; readonly driftCanaryProtocolVersion?: string } {
  return {
    ...(annotation?.runId ? { runId: annotation.runId } : {}),
    ...(annotation?.suiteTaskId ? { suiteTaskId: annotation.suiteTaskId } : {}),
    ...(annotation?.driftCanaryProtocolVersion
      ? { driftCanaryProtocolVersion: annotation.driftCanaryProtocolVersion }
      : {}),
  };
}

function shouldPassThroughStream(body: JsonRecord, response: Response): boolean {
  return body.stream === true &&
    response.body !== null &&
    (response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream");
}

function responseIsSuccessful(event: CanonicalEventAny): boolean {
  if (!isRecord(event) || !isRecord(event.response)) return false;
  const statusCode = event.response.statusCode;
  return typeof statusCode === "number" && statusCode < 400;
}

function localJsonError(status: number, code: string, message: string): Response {
  return new Response(localJsonErrorBody(code, message), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function localJsonErrorBody(code: string, message: string): string {
  return JSON.stringify({ error: { type: code, message } });
}

function missingProviderKeyMessage(provider: ProviderName): string {
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

function providerTransportErrorBody(provider: ProviderName): string {
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

function unreachableProvider(provider: never): never {
  throw new Error(`Unsupported provider ${String(provider)}.`);
}

function passThroughHeaders(headers: Headers): Headers {
  const output = new Headers();
  for (const [name, value] of headers.entries()) {
    if (isHopByHopHeader(name)) continue;
    output.set(name, value);
  }
  return output;
}

function isHopByHopHeader(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "connection" ||
    normalized === "content-encoding" ||
    normalized === "content-length" ||
    normalized === "keep-alive" ||
    normalized === "set-cookie" ||
    normalized === "transfer-encoding" ||
    normalized === "upgrade";
}

function copyOptionalHeader(from: Headers, to: Headers, name: string): void {
  const value = from.get(name);
  if (value) to.set(name, value);
}

function captureErrorMessage(error: unknown): string {
  return error instanceof Error
    ? `inferock-bench capture error: ${error.message}`
    : "inferock-bench capture error";
}
