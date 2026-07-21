import { describe, expect, it } from "vitest";
import {
  CANONICAL_OPERATION_ID_MAX_LENGTH,
  CanonicalEventAny,
  CanonicalEventV1,
  CanonicalEventV2,
  canonicalEventErrorOrigin,
  normalizeCanonicalEvent,
  type CanonicalEventV2 as CanonicalEventV2Type,
} from "./canonical-event.js";

const validEvent = {
  request: {
    tenantId: "tenant-1",
    provider: "openai",
    model: "gpt-5-mini",
    requestId: "req-1",
    expectCompletion: true,
  },
  response: {
    statusCode: 200,
    finishReason: "stop",
    content: "completed",
    toolCalls: [{ id: "call-1", name: "lookup" }],
  },
  usage: {
    input: 12,
    output: 5,
    cache: {
      read: 3,
      creation: 1,
    },
  },
  timing: {
    startedAt: "2026-06-14T12:00:00.000Z",
    endedAt: "2026-06-14T12:00:01.250Z",
    latencyMs: 1250,
  },
  meta: {
    attemptIndex: 0,
    schemaVersion: "v1",
  },
} as const;

describe("CanonicalEventV1", () => {
  it("canonical-event-v1-valid: parses a valid event", () => {
    expect(CanonicalEventV1.parse(validEvent)).toEqual(validEvent);
  });

  it("canonical-event-v1-still-parses-through-any: keeps existing v1 producers valid", () => {
    expect(CanonicalEventAny.parse(validEvent)).toEqual(validEvent);
  });

  it("canonical-event-v1-output-schema-version: preserves an optional tenant output schema version", () => {
    const event = {
      ...validEvent,
      meta: {
        ...validEvent.meta,
        outputSchemaVersion: "invoice-v3",
      },
    };

    expect(CanonicalEventV1.parse(event).meta).toEqual({
      attemptIndex: 0,
      schemaVersion: "v1",
      outputSchemaVersion: "invoice-v3",
    });
  });

  it("canonical-event-v1-meta-source: preserves optional event source provenance", () => {
    const event = {
      ...validEvent,
      meta: {
        ...validEvent.meta,
        source: "drift_replay",
      },
    };

    expect(CanonicalEventV1.parse(event).meta).toEqual({
      attemptIndex: 0,
      schemaVersion: "v1",
      source: "drift_replay",
    });
  });

  it("canonical-event-v1-route-workload: preserves optional SLO lookup metadata", () => {
    const event = {
      ...validEvent,
      request: {
        ...validEvent.request,
        route: "chat.completions",
        workloadClass: "interactive",
      },
    };

    expect(CanonicalEventV1.parse(event).request).toMatchObject({
      route: "chat.completions",
      workloadClass: "interactive",
    });
    expect(normalizeCanonicalEvent(event).request).toMatchObject({
      route: "chat.completions",
      workloadClass: "interactive",
    });
  });

  it("canonical-event-v1-gemini-provider: parses Gemini provider events", () => {
    const event = {
      ...validEvent,
      request: {
        ...validEvent.request,
        provider: "gemini",
        model: "gemini-2.5-flash",
      },
    };

    expect(CanonicalEventV1.parse(event)).toEqual(event);
    expect(normalizeCanonicalEvent(event).request.provider).toBe("gemini");
  });

  it("canonical-event-v1-openrouter-provider: parses OpenRouter provider events", () => {
    const event = {
      ...validEvent,
      request: {
        ...validEvent.request,
        provider: "openrouter",
        model: "mistralai/mistral-large-2512",
      },
    };

    expect(CanonicalEventV1.parse(event)).toEqual(event);
    expect(normalizeCanonicalEvent(event).request.provider).toBe("openrouter");
  });

  it("canonical-event-v1-missing-required: throws when a required field is missing", () => {
    const invalidEvent: unknown = {
      ...validEvent,
      request: {
        tenantId: validEvent.request.tenantId,
        provider: validEvent.request.provider,
        model: validEvent.request.model,
      },
    };

    expect(() => CanonicalEventV1.parse(invalidEvent)).toThrow();
  });
});

describe("CanonicalEventV2", () => {
  it("canonical-event-v2-minimal: parses the minimal v2 event shape", () => {
    const event = minimalV2Event();

    expect(CanonicalEventV2.parse(event)).toEqual(event);
    expect(CanonicalEventAny.parse(event)).toEqual(event);
  });

  it("canonical-event-error-origin: preserves local-origin error evidence on response and attempt", () => {
    const event: CanonicalEventV2Type = {
      ...minimalV2Event(),
      response: {
        ...minimalV2Event().response,
        statusCode: 429,
        finishReason: "error",
        content: "",
        errorClass: "http_429:agent_call_budget_exhausted",
        errorOrigin: "local",
      },
      timing: {
        ...minimalV2Event().timing,
        terminalStatus: "error",
      },
      attempts: [
        {
          ...minimalV2Event().attempts[0],
          status: "error",
          errorClass: "http_429:agent_call_budget_exhausted",
          errorOrigin: "local",
        },
      ],
    };

    expect(CanonicalEventV2.parse(event).response.errorOrigin).toBe("local");
    const normalized = normalizeCanonicalEvent(event);
    expect(canonicalEventErrorOrigin(normalized)).toBe("local");
    expect(normalized.attempts[0]?.errorOrigin).toBe("local");
  });

  it("canonical-event-v2-gemini-provider: parses Gemini provider and generateContent surface", () => {
    const event: CanonicalEventV2Type = {
      ...minimalV2Event(),
      request: {
        ...minimalV2Event().request,
        provider: "gemini",
        requestedModel: "gemini-2.5-flash",
        model: "gemini-2.5-flash",
        toolDeclarations: [
          {
            providerSurface: "gemini_generate_content",
            name: "lookup_invoice",
            schemaHash: "sha256:lookup-invoice",
          },
        ],
      },
      response: {
        ...minimalV2Event().response,
        servedModel: "gemini-2.5-flash-001",
        servedModelSource: "provider_response",
      },
      attempts: [
        {
          ...minimalV2Event().attempts[0],
          provider: "gemini",
          model: "gemini-2.5-flash-001",
        },
      ],
    };

    expect(CanonicalEventV2.parse(event)).toEqual(event);
    expect(normalizeCanonicalEvent(event).request.provider).toBe("gemini");
  });

  it("canonical-event-v2-openai-compatible-provider: parses OpenAI-compatible OSS host metadata without relabeling the surface", () => {
    const event: CanonicalEventV2Type = {
      ...minimalV2Event(),
      request: {
        ...minimalV2Event().request,
        provider: "mistral",
        requestedModel: "mistral-large-2512",
        model: "mistral-large-2512",
        providerPlane: "mistral_la_plateforme",
        authClass: "api_key",
        endpointSupportStatus: "procurement_gated",
        endpointSupportReason: "dormant_first_party_upgrade_key_and_fixture_needed",
        generation: {
          tokenizerOracle: "fixture_needed",
        },
        toolDeclarations: [
          {
            providerSurface: "openai_compatible_chat",
            name: "lookup_invoice",
            schemaHash: "sha256:lookup-invoice",
          },
        ],
      },
      response: {
        ...minimalV2Event().response,
        servedModel: "mistral-large-2512",
        servedModelSource: "provider_response",
      },
      usage: {
        ...minimalV2Event().usage,
        categories: [
          { category: "prompt", tokens: 12, sourceField: "prompt_tokens" },
          {
            category: "provider:mistral:prompt_tokens",
            tokens: 12,
            sourceField: "prompt_tokens",
            provider: "mistral",
          },
        ],
      },
      attempts: [
        {
          ...minimalV2Event().attempts[0],
          provider: "mistral",
          model: "mistral-large-2512",
        },
      ],
    };

    expect(CanonicalEventV2.parse(event)).toEqual(event);
    expect(normalizeCanonicalEvent(event).request).toMatchObject({
      provider: "mistral",
      endpointSupportStatus: "procurement_gated",
      toolDeclarations: [
        {
          providerSurface: "openai_compatible_chat",
          name: "lookup_invoice",
        },
      ],
    });
  });

  it("canonical-event-v2-full: parses all row-reserved v2 fields", () => {
    const event = fullV2Event();

    expect(CanonicalEventV2.parse(event)).toEqual(event);
    expect(CanonicalEventAny.parse(event)).toEqual(event);
  });

  it("canonical-event-v2-retry-chain-identity: preserves passive retry-chain identity fields", () => {
    const event: CanonicalEventV2Type = {
      ...minimalV2Event(),
      request: {
        ...minimalV2Event().request,
        operationId: "checkout-01FZ6M4RFZ9T8YC7QJ6QYQ9WZP",
        apiKeyHash: "sha256:0b6e5ec8e0a9be7d42e05a321cd05c61b0320860f762d5b1e9fb5cc9d73bce19",
        bodyHash: "sha256:490ae7ad4e088bed5f79b8cbe8302c50a1b7ddcaf8bc0922412303a07c771cdc",
        bodyHashAlgorithm: "sha256",
        bodyHashCanonicalization: "normalized_json_v1",
      },
      attempts: [
        {
          ...minimalV2Event().attempts[0],
          statusCode: 429,
          providerRequestId: "provider-retry-1",
          sanitizedHeaders: {
            "retry-after": "2",
            "x-should-retry": "true",
          },
        },
      ],
    };

    expect(CanonicalEventV2.parse(event)).toEqual(event);
    expect(normalizeCanonicalEvent(event).request).toMatchObject({
      operationId: "checkout-01FZ6M4RFZ9T8YC7QJ6QYQ9WZP",
      apiKeyHash: "sha256:0b6e5ec8e0a9be7d42e05a321cd05c61b0320860f762d5b1e9fb5cc9d73bce19",
      bodyHash: "sha256:490ae7ad4e088bed5f79b8cbe8302c50a1b7ddcaf8bc0922412303a07c771cdc",
      bodyHashAlgorithm: "sha256",
      bodyHashCanonicalization: "normalized_json_v1",
    });
  });

  it("canonical-event-v2-operation-id-bounds: accepts the maximum printable ASCII operation ID", () => {
    const operationId = "x".repeat(CANONICAL_OPERATION_ID_MAX_LENGTH);
    const event: CanonicalEventV2Type = {
      ...minimalV2Event(),
      request: {
        ...minimalV2Event().request,
        operationId,
      },
    };

    expect(CanonicalEventV2.parse(event).request.operationId).toBe(operationId);
  });

  it("canonical-event-v2-operation-id-rejects-unbounded-or-control-values: rejects unsafe operation IDs", () => {
    const invalidOperationIds = [
      "x".repeat(CANONICAL_OPERATION_ID_MAX_LENGTH + 1),
      "checkout\nretry",
      "checkout\u007Fretry",
      "checkout-å",
    ];

    for (const operationId of invalidOperationIds) {
      const event: CanonicalEventV2Type = {
        ...minimalV2Event(),
        request: {
          ...minimalV2Event().request,
          operationId,
        },
      };

      expect(() => CanonicalEventV2.parse(event)).toThrow();
      expect(() => CanonicalEventAny.parse(event)).toThrow();
    }
  });

  it("canonical-event-v2-tool-declaration-schema-absent: preserves a declared tool when no schema was captured", () => {
    const event: CanonicalEventV2Type = {
      ...minimalV2Event(),
      request: {
        ...minimalV2Event().request,
        toolDeclarations: [
          {
            providerSurface: "chat_completions",
            name: "lookup_invoice",
            schemaHash: "schema_absent",
          },
        ],
      },
    };

    expect(CanonicalEventV2.parse(event)).toEqual(event);
    expect(normalizeCanonicalEvent(event).request.toolDeclarations).toEqual(event.request.toolDeclarations);
  });

  it("canonical-event-v2-request-security-context: preserves bounded digest-only request secret evidence", () => {
    const event: CanonicalEventV2Type = {
      ...minimalV2Event(),
      request: {
        ...minimalV2Event().request,
        securityContext: requestSecurityContextFixture(),
      },
    };

    expect(CanonicalEventV2.parse(event)).toEqual(event);
    expect(normalizeCanonicalEvent(event).request.securityContext).toEqual(event.request.securityContext);
    expect(JSON.stringify(event.request.securityContext)).not.toContain("sk-proj-");
  });

  it("canonical-event-v2-request-security-context-rejects-raw-or-unbounded-shapes", () => {
    const rawSecretEvent: unknown = {
      ...minimalV2Event(),
      request: {
        ...minimalV2Event().request,
        securityContext: {
          ...requestSecurityContextFixture(),
          rawSecret: "sk-proj-raw",
        },
      },
    };
    const invalidDigestEvent: unknown = {
      ...minimalV2Event(),
      request: {
        ...minimalV2Event().request,
        securityContext: {
          ...requestSecurityContextFixture(),
          requestSecretDigests: [{
            ...requestSecurityContextFixture().requestSecretDigests[0],
            digest: "sha256:not-hmac",
          }],
        },
      },
    };
    const overlongPathEvent: unknown = {
      ...minimalV2Event(),
      request: {
        ...minimalV2Event().request,
        securityContext: {
          ...requestSecurityContextFixture(),
          requestSecretDigests: [{
            ...requestSecurityContextFixture().requestSecretDigests[0],
            fieldPath: `request.body.${"x".repeat(512)}`,
          }],
        },
      },
    };
    const inconsistentTruncationEvent: unknown = {
      ...minimalV2Event(),
      request: {
        ...minimalV2Event().request,
        securityContext: {
          ...requestSecurityContextFixture(),
          captureComplete: true,
          truncated: true,
        },
      },
    };

    for (const event of [
      rawSecretEvent,
      invalidDigestEvent,
      overlongPathEvent,
      inconsistentTruncationEvent,
    ]) {
      expect(() => CanonicalEventV2.parse(event)).toThrow();
      expect(() => CanonicalEventAny.parse(event)).toThrow();
    }
  });

  it("canonical-event-v2-retrieval-context: preserves row-11 retrieval evidence", () => {
    const event: CanonicalEventV2Type = {
      ...minimalV2Event(),
      retrieval: {
        context: [
          {
            source: "kb",
            chunkId: "chunk-1",
            sourceHash: "sha256:source",
            retrieverVersion: "retriever-v1",
            corpusVersion: "corpus-v4",
            title: "Policy",
            uri: "https://example.com/policy",
            textHash: "sha256:text",
            redactedExcerpt: "The policy states...",
            authoritative: true,
          },
        ],
      },
    };

    expect(CanonicalEventAny.parse(event)).toEqual(event);
    expect(normalizeCanonicalEvent(event).retrieval).toBe(event.retrieval);
  });

  it("canonical-event-normalizer-round-trip: retains raw v2 and exposes v1-compatible aliases", () => {
    const event = fullV2Event();

    const normalized = normalizeCanonicalEvent(event);

    expect(normalized.rawOriginalEvent).toBe(event);
    expect(normalized.schemaVersion).toBe("v2");
    expect(normalized.request.model).toBe("gpt-5-mini");
    expect(normalized.request.requestedModel).toBe("gpt-5-mini");
    expect(normalized.request.sanitizedHeaders).toEqual({
      "x-stainless-retry-count": "0",
    });
    expect(normalized.request.generation).toMatchObject({
      eagerInputStreaming: true,
    });
    expect(normalized.response.servedModel).toBe("gpt-5-mini-2026-06-01");
    expect(normalized.response.servedModelSource).toBe("provider_response");
    expect(normalized.response.serviceTier).toBe("default");
    expect(normalized.response.stopDetails).toEqual({
      type: "refusal",
      category: "safety",
    });
    expect(normalized.usage).toMatchObject({
      serviceTier: "standard",
      inferenceGeo: "us",
      iterations: 2,
    });
    expect(normalized.timing.firstEventAt).toBe("2026-06-14T12:00:00.100Z");
    expect(normalized.timing.firstContentDeltaAt).toBe("2026-06-14T12:00:00.175Z");
    expect(normalized.timing.providerRequestStartedAt).toBe("2026-06-14T12:00:00.010Z");
    expect(normalized.timing.providerResponseEndedAt).toBe("2026-06-14T12:00:01.210Z");
    expect(normalized.timing.providerElapsedMs).toBe(1200);
    expect(normalized.timing.gatewayOverheadMs).toBe(50);
    expect(normalized.timing.clientConsumptionEndedAt).toBe("2026-06-14T12:00:03.000Z");
    expect(normalized.attempts[1]?.timing).toMatchObject({
      providerRequestStartedAt: "2026-06-14T12:00:00.010Z",
      providerResponseEndedAt: "2026-06-14T12:00:01.210Z",
      providerElapsedMs: 1200,
      gatewayOverheadMs: 50,
      clientConsumptionEndedAt: "2026-06-14T12:00:03.000Z",
    });
    expect(normalized.meta).toEqual({
      attemptIndex: 1,
      schemaVersion: "v1",
      outputSchemaVersion: "invoice-v3",
    });
  });

  it("canonical-event-normalizer-v2-old-stream-timing-aliases: accepts old v2 timing fields", () => {
    const event: CanonicalEventV2Type = {
      ...minimalV2Event(),
      timing: {
        ...minimalV2Event().timing,
        firstByteAt: "2026-06-14T12:00:00.100Z",
        firstTokenAt: "2026-06-14T12:00:00.175Z",
        timeToFirstByteMs: 100,
        timeToFirstTokenMs: 175,
        maxStreamGapMs: 50,
      },
    };

    const normalized = normalizeCanonicalEvent(event);

    expect(normalized.timing.firstEventAt).toBe("2026-06-14T12:00:00.100Z");
    expect(normalized.timing.firstContentDeltaAt).toBe("2026-06-14T12:00:00.175Z");
    expect(normalized.timing.timeToFirstEventMs).toBe(100);
    expect(normalized.timing.timeToFirstContentDeltaMs).toBe(175);
    expect(normalized.timing.maxInterChunkGapMs).toBe(50);
  });

  it("canonical-event-normalizer-v1: retains raw v1 and synthesizes requested/served model aliases", () => {
    const normalized = normalizeCanonicalEvent(validEvent);

    expect(normalized.rawOriginalEvent).toBe(validEvent);
    expect(normalized.schemaVersion).toBe("v1");
    expect(normalized.request.requestedModel).toBe("gpt-5-mini");
    expect(normalized.response.servedModel).toBe("gpt-5-mini");
    expect(normalized.attempts).toEqual([
      {
        attemptNumber: 0,
        provider: "openai",
        model: "gpt-5-mini",
        status: "success",
        timing: validEvent.timing,
        finalSelected: true,
      },
    ]);
  });
});

function minimalV2Event(): CanonicalEventV2Type {
  return {
    schemaVersion: "v2",
    request: {
      tenantId: "tenant-1",
      provider: "openai",
      requestId: "req-1",
      requestedModel: "gpt-5-mini",
      model: "gpt-5-mini",
      attemptIndex: 0,
    },
    response: {
      statusCode: 200,
      finishReason: "stop",
      content: "completed",
      servedModel: "gpt-5-mini",
    },
    usage: {
      input: 12,
      output: 5,
      usageSource: "provider",
      categories: [
        { category: "prompt", tokens: 12, sourceField: "prompt_tokens" },
        { category: "completion", tokens: 5, sourceField: "completion_tokens" },
      ],
    },
    timing: {
      startedAt: "2026-06-14T12:00:00.000Z",
      endedAt: "2026-06-14T12:00:01.250Z",
      latencyMs: 1250,
      chunkCount: 0,
      terminalStatus: "complete",
    },
    attempts: [
      {
        attemptNumber: 0,
        provider: "openai",
        model: "gpt-5-mini",
        status: "success",
        timing: {
          startedAt: "2026-06-14T12:00:00.000Z",
          endedAt: "2026-06-14T12:00:01.250Z",
          latencyMs: 1250,
        },
        finalSelected: true,
      },
    ],
  };
}

function fullV2Event(): CanonicalEventV2Type {
  return {
    ...minimalV2Event(),
    request: {
      tenantId: "tenant-1",
      provider: "openai",
      requestId: "req-1",
      providerRequestId: "provider-req-1",
      requestedModel: "gpt-5-mini",
      model: "gpt-5-mini",
      attemptIndex: 1,
      operationId: "checkout-01FZ6M4RFZ9T8YC7QJ6QYQ9WZP",
      apiKeyHash: "sha256:0b6e5ec8e0a9be7d42e05a321cd05c61b0320860f762d5b1e9fb5cc9d73bce19",
      bodyHash: "sha256:490ae7ad4e088bed5f79b8cbe8302c50a1b7ddcaf8bc0922412303a07c771cdc",
      bodyHashAlgorithm: "sha256",
      bodyHashCanonicalization: "normalized_json_v1",
      retryCorrelationId: "retry-group-1",
      expectCompletion: true,
      route: "chat.completions",
      workloadClass: "interactive",
      outputSchemaVersion: "invoice-v3",
      generation: {
        temperature: 0.2,
        maxCompletionTokens: 256,
        eagerInputStreaming: true,
      },
      factualityContract: {
        required: true,
        verifier: "citation-required",
      },
      securityContext: requestSecurityContextFixture(),
      sanitizedHeaders: {
        "x-stainless-retry-count": "0",
      },
      toolDeclarations: [
        {
          providerSurface: "chat_completions",
          name: "lookup_invoice",
          schemaHash: "sha256:abc123",
          schema: {
            type: "object",
            properties: {
              id: { type: "string" },
            },
          },
          strict: true,
          toolChoice: "auto",
          parallelToolCalls: false,
        },
      ],
    },
    response: {
      statusCode: 200,
      finishReason: "stop",
      content: "completed",
      toolCalls: [{ id: "call-1", name: "lookup_invoice" }],
      rawToolCalls: [{ provider_shape: "raw-call-1" }],
      servedModel: "gpt-5-mini-2026-06-01",
      servedModelSource: "provider_response",
      providerRequestId: "provider-req-1",
      providerResponseId: "chatcmpl_1",
      rawObjectId: "chatcmpl_1",
      systemFingerprint: "fp_1",
      serviceTier: "default",
      sanitizedHeaders: {
        "x-request-id": "provider-req-1",
        "x-ratelimit-remaining-requests": "9",
      },
      rawErrorType: "none",
      rawErrorCode: "none",
      stopDetails: {
        type: "refusal",
        category: "safety",
      },
      providerSafety: [
        {
          kind: "refusal",
          source: "provider",
          reason: "policy",
          raw: { refusal: true },
        },
      ],
      citations: [{ url: "https://example.com/source", title: "Source" }],
      grounding: { score: 0.98 },
      logprobs: [{ token: "completed", logprob: -0.1 }],
    },
    usage: {
      input: 12,
      output: 5,
      cache: {
        read: 3,
        creation: 1,
      },
      raw: {
        prompt_tokens: 15,
        completion_tokens: 5,
        prompt_tokens_details: {
          cached_tokens: 3,
        },
      },
      categories: [
        { category: "prompt", tokens: 15, sourceField: "prompt_tokens" },
        { category: "completion", tokens: 5, sourceField: "completion_tokens" },
        { category: "cached", tokens: 3, sourceField: "prompt_tokens_details.cached_tokens" },
        { category: "reasoning", tokens: 2, sourceField: "completion_tokens_details.reasoning_tokens" },
        { category: "provider:openai:prompt_tokens", tokens: 15, sourceField: "prompt_tokens" },
      ],
      usageSource: "provider",
      pricingStatus: "not_priced",
      serviceTier: "standard",
      inferenceGeo: "us",
      iterations: 2,
    },
    timing: {
      startedAt: "2026-06-14T12:00:00.000Z",
      providerRequestStartedAt: "2026-06-14T12:00:00.010Z",
      firstEventAt: "2026-06-14T12:00:00.100Z",
      firstContentDeltaAt: "2026-06-14T12:00:00.175Z",
      firstByteAt: "2026-06-14T12:00:00.100Z",
      firstTokenAt: "2026-06-14T12:00:00.175Z",
      lastChunkAt: "2026-06-14T12:00:01.200Z",
      providerResponseEndedAt: "2026-06-14T12:00:01.210Z",
      endedAt: "2026-06-14T12:00:01.250Z",
      clientConsumptionEndedAt: "2026-06-14T12:00:03.000Z",
      latencyMs: 1250,
      providerElapsedMs: 1200,
      gatewayOverheadMs: 50,
      timeToFirstEventMs: 100,
      timeToFirstContentDeltaMs: 175,
      timeToFirstByteMs: 100,
      timeToFirstTokenMs: 175,
      chunkCount: 4,
      maxInterChunkGapMs: 500,
      maxStreamGapMs: 500,
      terminalStatus: "complete",
    },
    attempts: [
      {
        attemptNumber: 0,
        provider: "openai",
        model: "gpt-5-mini",
        status: "retry",
        timing: {
          startedAt: "2026-06-14T11:59:59.000Z",
          endedAt: "2026-06-14T11:59:59.500Z",
          latencyMs: 500,
        },
        errorClass: "http_500:server_error",
        retryReason: "retryable_http_500",
        statusCode: 500,
        providerRequestId: "provider-retry-1",
        sanitizedHeaders: {
          "retry-after": "2",
          "x-should-retry": "true",
        },
        finalSelected: false,
      },
      {
        attemptNumber: 1,
        provider: "openai",
        model: "gpt-5-mini",
        status: "success",
        timing: {
          startedAt: "2026-06-14T12:00:00.000Z",
          providerRequestStartedAt: "2026-06-14T12:00:00.010Z",
          providerResponseEndedAt: "2026-06-14T12:00:01.210Z",
          endedAt: "2026-06-14T12:00:01.250Z",
          clientConsumptionEndedAt: "2026-06-14T12:00:03.000Z",
          latencyMs: 1250,
          providerElapsedMs: 1200,
          gatewayOverheadMs: 50,
        },
        finalSelected: true,
      },
    ],
  };
}

function requestSecurityContextFixture(): NonNullable<CanonicalEventV2Type["request"]["securityContext"]> {
  return {
    captureVersion: "request_secret_digest_v1",
    digestKeyId: "f6-dev",
    requestSecretDigests: [
      {
        kind: "secret",
        category: "openai_api_key",
        fieldPath: "request.body.messages[0].content",
        matchLength: 84,
        digest: `hmac-sha256:f6-dev:${"a".repeat(64)}`,
        digestAlgorithm: "hmac-sha256",
        digestKeyId: "f6-dev",
        digestScope: "event",
        patternVersion: "security-governance:v0",
      },
    ],
    captureComplete: true,
    truncated: false,
  };
}
