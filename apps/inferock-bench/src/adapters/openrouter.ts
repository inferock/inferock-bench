import type { CanonicalEventV2 } from "@inferock/measure/canonical-event";
import {
  asRecord,
  joinUrl,
  parseJsonRecord,
  recordArray,
  stringValue,
  type JsonRecord,
} from "../record.js";
import {
  WATERMARK_NAME,
  WATERMARK_URL,
} from "../config.js";
import {
  openRouterPinnedEndpointForModel,
  openRouterPinnedRequestBody,
  openRouterProviderSelectionMatchesPinned,
} from "../openrouter-pins.js";
import {
  mapOpenAiResponseToCanonical,
  observeOpenAiCompatibleStream,
  withOpenAiStreamUsage,
  type OpenAiCompatibleOptions,
} from "./openai.js";
import type {
  AdapterBuildRequestInput,
  AdapterCanonicalInput,
  AdapterCanonicalResult,
  AdapterStreamInput,
  ProviderAdapter,
  ProviderFetchRequest,
} from "./types.js";

type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>;

const OPENROUTER_METADATA_FIELD_PATH = "$.openrouter_metadata.endpoints.available";

const OPENROUTER_COMPATIBLE_OPTIONS: OpenAiCompatibleOptions = {
  provider: "openrouter",
  providerSurface: "openai_compatible_chat",
  usageProvider: "openrouter",
  responseEvidence: openRouterResponseEvidence,
};

/**
 * @contract-id openrouter-adapter
 */
export const openRouterAdapter: ProviderAdapter = {
  provider: "openrouter",
  buildRequest(input: AdapterBuildRequestInput): ProviderFetchRequest {
    const payload = withOpenAiStreamUsage(openRouterPinnedRequestBody(input.body));
    if (!openRouterProviderSelectionMatchesPinned(payload)) {
      throw new Error("OpenRouter endpoint pin validation failed after request-body construction.");
    }
    return {
      url: joinUrl(input.baseUrl, "/chat/completions"),
      init: {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
          "http-referer": WATERMARK_URL,
          "x-openrouter-metadata": "enabled",
          "x-openrouter-title": WATERMARK_NAME,
        },
        body: JSON.stringify(payload),
      },
      canonicalRequestBody: payload,
    };
  },
  toCanonicalEvent(input: AdapterCanonicalInput): AdapterCanonicalResult {
    return mapOpenAiResponseToCanonical(input, OPENROUTER_COMPATIBLE_OPTIONS);
  },
  observeStream(input: AdapterStreamInput): ReadableStream<Uint8Array> {
    return observeOpenAiCompatibleStream(input, OPENROUTER_COMPATIBLE_OPTIONS);
  },
};

export async function openRouterEndpointEvidenceForRequest(input: {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly requestBody: JsonRecord;
  readonly providerFetch: ProviderFetch;
}): Promise<JsonRecord> {
  const model = stringValue(input.requestBody.model);
  const pinned = openRouterPinnedEndpointForModel(model);
  if (!pinned) {
    return {
      openRouterEndpoint: {
        status: "pin_missing",
        requestedModel: model ?? "unknown_model",
      },
    };
  }

  const source = joinUrl(input.baseUrl, `/models/${pinned.model}/endpoints`);
  try {
    const response = await input.providerFetch(source, {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
    });
    const parsed = parseJsonRecord(await response.text());
    const endpoint = selectedPinnedEndpoint(parsed, pinned);
    if (!response.ok || !endpoint) {
      return {
        openRouterEndpoint: {
          status: "endpoint_missing",
          requestedModel: pinned.model,
          pinnedProvider: pinned.providerSlug,
          source,
          httpStatus: response.status,
        },
      };
    }
    const pricing = asRecord(endpoint.pricing);
    const endpointPriceSnapshot = normalizedEndpointPriceSnapshot(pricing);
    return {
      openRouterEndpoint: {
        status: "captured",
        requestedModel: pinned.model,
        pinnedProvider: pinned.providerSlug,
        source,
        endpointProviderTag: stringValue(endpoint.tag) ?? pinned.providerSlug,
        endpointProviderName: stringValue(endpoint.provider_name),
        endpointModel: stringValue(endpoint.model_id) ?? pinned.model,
        endpointQuantization: stringValue(endpoint.quantization) ?? pinned.quantization,
        ...(endpointPriceSnapshot ? { endpointPriceSnapshot } : {}),
      },
    };
  } catch {
    return {
      openRouterEndpoint: {
        status: "fetch_failed",
        requestedModel: pinned.model,
        pinnedProvider: pinned.providerSlug,
        source,
      },
    };
  }
}

function openRouterResponseEvidence(input: {
  readonly request: AdapterCanonicalInput | AdapterStreamInput;
  readonly parsed?: JsonRecord;
  readonly streamMetadata?: JsonRecord;
}): Partial<Pick<CanonicalEventV2["response"], "servedModel" | "servedModelSource" | "stopDetails">> {
  const metadata = input.streamMetadata ?? asRecord(input.parsed?.openrouter_metadata);
  const endpointEvidence = asRecord(input.request.providerEvidence?.openRouterEndpoint);
  const pinned = openRouterPinnedEndpointForModel(input.request.requestModel);
  const selected = selectedMetadataEndpoint(metadata);
  const base: JsonRecord = {
    ...(pinned ? { pinnedUpstreamProvider: pinned.providerSlug } : {}),
    ...(pinned?.quantization ? { pinnedEndpointQuantization: pinned.quantization } : {}),
    fallbacksAllowed: false,
    metadataStatus: metadata ? (selected ? "captured" : "captured_no_selected_endpoint") : "metadata_missing",
    ...(metadata ? { metadataFieldPath: OPENROUTER_METADATA_FIELD_PATH } : {}),
    ...(stringValue(metadata?.summary) ? { metadataSummary: stringValue(metadata?.summary) } : {}),
    ...(stringValue(metadata?.strategy) ? { routingStrategy: stringValue(metadata?.strategy) } : {}),
    ...(typeof metadata?.attempt === "number" ? { routerAttempt: metadata.attempt } : {}),
    ...(stringValue(metadata?.region) ? { routerRegion: stringValue(metadata?.region) } : {}),
    ...(stringValue(endpointEvidence?.source) ? { endpointPriceSource: stringValue(endpointEvidence?.source) } : {}),
  };

  if (!selected) return { stopDetails: { openRouter: base } };

  const selectedProviderDisplay = stringValue(selected.provider);
  const selectedMetadataModel = stringValue(selected.model) ?? input.request.requestModel;
  const selectedMatchesPinned = openRouterSelectedEndpointMatchesEvidence(selected, endpointEvidence);
  if (!selectedMatchesPinned) {
    return {
      stopDetails: {
        openRouter: {
          ...base,
          selectedUpstreamProvider: selectedProviderDisplay ?? "unknown_provider",
          selectedUpstreamModel: selectedMetadataModel,
          selectedEndpointMatchedPinnedSnapshot: false,
        },
      },
    };
  }

  const endpointPriceSnapshot = asRecord(endpointEvidence?.endpointPriceSnapshot);
  const selectedModel = stringValue(endpointEvidence?.endpointModel) ??
    stringValue(endpointEvidence?.requestedModel) ??
    selectedMetadataModel;
  return {
    servedModel: selectedModel,
    servedModelSource: "provider_response",
    stopDetails: {
      openRouter: {
        ...base,
        selectedUpstreamProvider: stringValue(endpointEvidence?.endpointProviderTag) ??
          stringValue(endpointEvidence?.pinnedProvider) ??
          selectedProviderDisplay ??
          "unknown_provider",
        ...(selectedProviderDisplay ? { selectedUpstreamProviderDisplay: selectedProviderDisplay } : {}),
        selectedUpstreamModel: selectedModel,
        ...(selectedMetadataModel !== selectedModel ? { selectedUpstreamMetadataModel: selectedMetadataModel } : {}),
        selectedEndpointMatchedPinnedSnapshot: true,
        ...(stringValue(endpointEvidence?.endpointQuantization)
          ? { endpointQuantization: stringValue(endpointEvidence?.endpointQuantization) }
          : {}),
        ...(endpointPriceSnapshot ? { endpointPriceSnapshot } : {}),
      },
    },
  };
}

function selectedPinnedEndpoint(
  parsed: JsonRecord | null | undefined,
  pinned: NonNullable<ReturnType<typeof openRouterPinnedEndpointForModel>>,
): JsonRecord | undefined {
  const endpoints = recordArray(parsed?.endpoints) ?? recordArray(asRecord(parsed?.data)?.endpoints) ?? [];
  return endpoints.find((endpoint) => {
    const tag = stringValue(endpoint.tag) ?? stringValue(endpoint.provider_slug);
    if (tag !== pinned.providerSlug && tag !== pinned.providerSlug.split("/")[0]) return false;
    const quantization = stringValue(endpoint.quantization);
    return !pinned.quantization || quantization === pinned.quantization;
  });
}

function normalizedEndpointPriceSnapshot(pricing: JsonRecord | undefined): JsonRecord | undefined {
  if (!pricing) return undefined;
  const prompt = stringOrNumber(pricing.prompt ?? pricing.input);
  const completion = stringOrNumber(pricing.completion ?? pricing.output);
  const cacheRead = stringOrNumber(pricing.cache_read ?? pricing.cacheRead ?? pricing.input_cache_read);
  const snapshot: JsonRecord = {
    ...(prompt !== undefined ? { prompt } : {}),
    ...(completion !== undefined ? { completion } : {}),
    ...(cacheRead !== undefined ? { cache_read: cacheRead } : {}),
  };
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

function selectedMetadataEndpoint(metadata: JsonRecord | undefined): JsonRecord | undefined {
  const endpoints = asRecord(metadata?.endpoints);
  const available = recordArray(endpoints?.available) ?? [];
  return available.find((endpoint) => endpoint.selected === true);
}

function openRouterSelectedEndpointMatchesEvidence(
  selected: JsonRecord,
  endpointEvidence: JsonRecord | undefined,
): boolean {
  if (endpointEvidence?.status !== "captured") return false;
  const selectedProvider = stringValue(selected.provider);
  const evidenceProviderName = stringValue(endpointEvidence.endpointProviderName);
  const evidenceProviderTag = stringValue(endpointEvidence.endpointProviderTag);
  const pinnedProvider = stringValue(endpointEvidence.pinnedProvider);
  const selectedProviderKey = normalizedProviderLabel(selectedProvider);
  return selectedProviderKey.length > 0 &&
    [
      normalizedProviderLabel(evidenceProviderName),
      normalizedProviderLabel(evidenceProviderTag),
      normalizedProviderLabel(pinnedProvider),
      normalizedProviderLabel(pinnedProvider?.split("/")[0]),
    ].includes(selectedProviderKey);
}

function normalizedProviderLabel(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function stringOrNumber(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return undefined;
}
