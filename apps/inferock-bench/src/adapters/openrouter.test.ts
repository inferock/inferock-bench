import { estimateCostUsd, lookupPriceForEvent, OPENROUTER_PLANE } from "@inferock/measure/pricing";
import { describe, expect, it } from "vitest";
import {
  isOpenRouterPinningError,
  openRouterPinnedEndpointForModel,
} from "../openrouter-pins.js";
import { parseJsonRecord } from "../record.js";
import {
  openRouterAdapter,
  openRouterEndpointEvidenceForRequest,
} from "./openrouter.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const STARTED_AT = new Date("2026-07-07T04:00:00.000Z");
const ENDED_AT = new Date("2026-07-07T04:00:01.000Z");
const MISTRAL_MODEL = "mistralai/mistral-large-2512";
const MISTRAL_PROVIDER_VARIANT = "mistral-large-2512-provider-variant";

describe("inferock-bench openRouterAdapter", () => {
  it("pins provider routing and opts into router metadata", () => {
    const request = openRouterAdapter.buildRequest({
      body: {
        model: MISTRAL_MODEL,
        messages: [{ role: "user", content: "Return ok." }],
        stream: true,
      },
      apiKey: "sk-or-test",
      baseUrl: OPENROUTER_BASE_URL,
    });
    const sent = parseJsonRecord(String(request.init.body));

    expect(request.url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    expect(new Headers(request.init.headers).get("x-openrouter-metadata")).toBe("enabled");
    expect(sent).toMatchObject({
      model: MISTRAL_MODEL,
      provider: {
        order: ["mistral"],
        only: ["mistral"],
        allow_fallbacks: false,
        require_parameters: true,
      },
      stream_options: { include_usage: true },
    });
    expect(request.canonicalRequestBody).toEqual(sent);
  });

  it("fails closed when caller tries to override OpenRouter routing", () => {
    try {
      openRouterAdapter.buildRequest({
        body: {
          model: MISTRAL_MODEL,
          messages: [{ role: "user", content: "Return ok." }],
          provider: { allow_fallbacks: true },
        },
        apiKey: "sk-or-test",
        baseUrl: OPENROUTER_BASE_URL,
      });
      throw new Error("expected OpenRouter pinning failure");
    } catch (error) {
      expect(isOpenRouterPinningError(error)).toBe(true);
      expect(error).toMatchObject({ code: "openrouter_endpoint_pin_required" });
    }

    try {
      openRouterAdapter.buildRequest({
        body: { model: "unmodeled/model", messages: [] },
        apiKey: "sk-or-test",
        baseUrl: OPENROUTER_BASE_URL,
      });
    } catch (error) {
      expect(isOpenRouterPinningError(error)).toBe(true);
    }
  });

  it("records selected endpoint metadata and enables observed OpenRouter pricing", async () => {
    const request = openRouterAdapter.buildRequest({
      body: {
        model: MISTRAL_MODEL,
        messages: [{ role: "user", content: "Return ok." }],
      },
      apiKey: "sk-or-test",
      baseUrl: OPENROUTER_BASE_URL,
    });
    const requestBody = parseJsonRecord(String(request.init.body));
    expect(requestBody).not.toBeNull();

    const providerEvidence = await openRouterEndpointEvidenceForRequest({
      baseUrl: OPENROUTER_BASE_URL,
      apiKey: "sk-or-test",
      requestBody: requestBody ?? {},
      providerFetch: async (url, init) => {
        expect(url).toBe(`${OPENROUTER_BASE_URL}/models/${MISTRAL_MODEL}/endpoints`);
        expect(init.method).toBe("GET");
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-or-test");
        return new Response(JSON.stringify({
          data: {
            id: MISTRAL_MODEL,
            endpoints: [{
              tag: "mistral",
              provider_name: "Mistral",
              model_id: MISTRAL_MODEL,
              quantization: "unknown",
              pricing: {
                prompt: "0.0000005",
                completion: "0.0000015",
                input_cache_read: "0.00000005",
              },
            }],
          },
        }), { status: 200 });
      },
    });

    const result = openRouterAdapter.toCanonicalEvent({
      tenantId: "tenant-openrouter",
      requestId: "req-openrouter-observed",
      requestModel: MISTRAL_MODEL,
      requestBody: requestBody ?? {},
      apiKeyHash: `sha256:${"a".repeat(64)}`,
      expectCompletion: true,
      route: "openrouter_chat_completions",
      statusCode: 200,
      requestHeaders: new Headers(),
      headers: new Headers(),
      responseBody: JSON.stringify({
        id: "gen-openrouter-observed",
        model: MISTRAL_PROVIDER_VARIANT,
        choices: [{
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: 1_000,
          completion_tokens: 100,
          total_tokens: 1_100,
          completion_tokens_details: {
            reasoning_tokens: 42,
          },
        },
        openrouter_metadata: {
          strategy: "order",
          endpoints: {
            available: [{
              provider: "Mistral",
              model: MISTRAL_PROVIDER_VARIANT,
              selected: true,
            }],
          },
        },
      }),
      baseUrl: OPENROUTER_BASE_URL,
      startedAt: STARTED_AT,
      endedAt: ENDED_AT,
      attemptIndex: 0,
      providerEvidence,
    });

    expect(result.event.request).toMatchObject({
      provider: "openrouter",
      providerPlane: OPENROUTER_PLANE,
      baseUrlHost: "openrouter.ai",
      authClass: "api_key",
      endpointSupportStatus: "supported",
      generation: {
        openRouterPinnedUpstream: "mistral",
        openRouterFallbacksAllowed: false,
      },
    });
    expect(result.event.response.stopDetails?.openRouter).toMatchObject({
      selectedUpstreamProvider: "mistral",
      selectedUpstreamProviderDisplay: "Mistral",
      selectedUpstreamModel: MISTRAL_MODEL,
      selectedUpstreamMetadataModel: MISTRAL_PROVIDER_VARIANT,
      metadataStatus: "captured",
      metadataFieldPath: "$.openrouter_metadata.endpoints.available",
      selectedEndpointMatchedPinnedSnapshot: true,
      endpointPriceSnapshot: {
        prompt: "0.0000005",
        completion: "0.0000015",
        cache_read: "0.00000005",
      },
    });
    expect(result.event.response).toMatchObject({
      servedModel: MISTRAL_MODEL,
      servedModelSource: "provider_response",
    });
    expect(result.event.usage.categories?.some((category) => category.category === "reasoning")).toBe(false);
    expect(result.event.usage.categories?.some((category) =>
      category.category === "provider:openrouter:completion_tokens_details.reasoning_tokens"
    )).toBe(false);
    expect(result.event.usage.raw).toMatchObject({
      completion_tokens_details: {
        reasoning_tokens: 42,
      },
    });
    expect(estimateCostUsd(result.event)).toBe(0.00065);
    expect(lookupPriceForEvent(result.event)).toMatchObject({ ok: true });
    expect(openRouterPinnedEndpointForModel(MISTRAL_MODEL)?.plane).toBe(`${OPENROUTER_PLANE}:mistral`);
  });

  it("keeps OpenRouter pricing unknown until router metadata and endpoint price evidence are captured", () => {
    const request = openRouterAdapter.buildRequest({
      body: {
        model: MISTRAL_MODEL,
        messages: [{ role: "user", content: "Return ok." }],
      },
      apiKey: "sk-or-test",
      baseUrl: OPENROUTER_BASE_URL,
    });
    const result = openRouterAdapter.toCanonicalEvent({
      tenantId: "tenant-openrouter",
      requestId: "req-openrouter-metadata-missing",
      requestModel: MISTRAL_MODEL,
      requestBody: parseJsonRecord(String(request.init.body)) ?? {},
      expectCompletion: true,
      route: "openrouter_chat_completions",
      statusCode: 200,
      requestHeaders: new Headers(),
      headers: new Headers(),
      responseBody: JSON.stringify({
        id: "gen-openrouter-metadata-missing",
        model: MISTRAL_MODEL,
        choices: [{
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: 1_000,
          completion_tokens: 100,
          total_tokens: 1_100,
        },
      }),
      baseUrl: OPENROUTER_BASE_URL,
      startedAt: STARTED_AT,
      endedAt: ENDED_AT,
      attemptIndex: 0,
    });

    expect(result.event.response.stopDetails?.openRouter).toMatchObject({
      metadataStatus: "metadata_missing",
    });
    expect(lookupPriceForEvent(result.event)).toMatchObject({
      ok: false,
      reason: "pricing_unknown",
      provider: "openrouter",
      model: MISTRAL_MODEL,
    });
  });
});
