import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeCanonicalEvent,
  type CanonicalEventNormalized,
  type CanonicalEventV2,
  type CanonicalUsageCategory,
} from "./canonical-event.js";
import { describe, expect, it } from "vitest";
import { buildCanonicalEvent } from "./test-utils/canonical-event-factory.js";
import {
  ANTHROPIC_TOKEN_CROSSCHECK_NOTE,
  buildAnthropicTokenCrossCheckSignal,
  crossCheckAnthropicOutputTokens,
} from "./anthropic-token-crosscheck.js";
import {
  buildCacheRateAnomalySignal,
  buildGeminiCountTokensRecountEvidence,
  countOpenAiOutputTokens,
  detectOpenAiTokenRecount,
} from "./billing-integrity.js";

const TOKENIZER_VARIANCE_TOLERANCE = 0.03;
const GPT_54_MINI_INPUT_RATE_USD_PER_MILLION = 0.75;
const GPT_54_MINI_OUTPUT_RATE_USD_PER_MILLION = 4.5;
const GPT_54_MINI_CACHE_READ_RATE_USD_PER_MILLION = 0.075;

describe("billing integrity Wave 2 overcharge economics", () => {
  it("gemini-count-tokens-recount-evidence: keeps countTokens as grade-B unverified input oracle evidence", () => {
    const event = normalizeCanonicalEvent({
      schemaVersion: "v2",
      request: {
        tenantId: "tenant-gemini",
        provider: "gemini",
        requestId: "req-gemini-count-tokens",
        requestedModel: "gemini-2.5-flash",
        model: "gemini-2.5-flash",
        attemptIndex: 0,
      },
      response: {
        statusCode: 200,
        finishReason: "stop",
        content: "completed",
        servedModel: "gemini-2.5-flash-001",
      },
      usage: {
        input: 80,
        output: 12,
        cache: { read: 40 },
        raw: {
          promptTokenCount: 120,
          cachedContentTokenCount: 40,
          candidatesTokenCount: 12,
          thoughtsTokenCount: 5,
          toolUsePromptTokenCount: 7,
          totalTokenCount: 177,
        },
        usageSource: "provider",
      },
      timing: {
        startedAt: "2026-07-06T12:00:00.000Z",
        endedAt: "2026-07-06T12:00:01.000Z",
        latencyMs: 1_000,
        chunkCount: 0,
        terminalStatus: "complete",
      },
      attempts: [
        {
          attemptNumber: 0,
          provider: "gemini",
          model: "gemini-2.5-flash-001",
          status: "success",
          timing: {
            startedAt: "2026-07-06T12:00:00.000Z",
            endedAt: "2026-07-06T12:00:01.000Z",
            latencyMs: 1_000,
          },
          finalSelected: true,
        },
      ],
    } satisfies CanonicalEventV2);

    expect(buildGeminiCountTokensRecountEvidence(event, {
      totalTokens: 120,
      source: "gemini.models.countTokens",
    })).toEqual({
      provider: "gemini",
      mode: "count_tokens_input_recount",
      methodId: "gemini_count_tokens_input_recount_v1",
      oracle: "gemini.models.countTokens",
      evidenceGrade: "B",
      billingStatus: "UNVERIFIED",
      countedInputTokens: 120,
      usagePromptTokenCount: 120,
      cachedContentTokenCount: 40,
      toolUsePromptTokenCount: 7,
      promptDeltaTokens: 0,
      comparedFields: [
        "usage.raw.promptTokenCount",
        "usage.raw.cachedContentTokenCount",
        "usage.raw.toolUsePromptTokenCount",
      ],
      note: "Gemini countTokens can recount input request tokens only; generated candidates and thinking tokens remain provider usage fields.",
    });
  });

  it("openai-token-recount-clean-normal-traffic: does not flag a realistic clean recount", () => {
    const event = openAiFixtureEvent("openai-chat-clean.json", {
      requestId: "req-wave2-clean",
    });
    const content = Array.from({ length: 8 }, () => event.response.content).join(" ");
    const recounted = countOpenAiOutputTokens(event.response.servedModel, content);
    const withinToleranceTokens = Math.floor(recounted * 0.02);
    const cleanEvent = {
      ...event,
      response: { ...event.response, content },
      usage: { ...event.usage, output: recounted + withinToleranceTokens },
    };

    expect(withinToleranceTokens / recounted).toBeLessThan(TOKENIZER_VARIANCE_TOLERANCE);
    expect(detectOpenAiTokenRecount(cleanEvent)).toBeNull();
  });

  it("openai-token-recount-gpt54-framing-fp: ignores the documented reply-primer allowance", () => {
    const content = "hello ".repeat(55).trim();
    const baseEvent = buildCanonicalEvent({
      request: {
        tenantId: "tenant-wave2-openai",
        provider: "openai",
        model: "gpt-5.4-mini",
        requestId: "req-wave2-gpt54-framing-fp",
      },
      response: {
        content,
      },
      usage: {
        input: 10,
        output: 58,
      },
    });
    const event = {
      ...baseEvent,
      response: {
        ...baseEvent.response,
        servedModel: "gpt-5.4-mini-2026-03-17",
      },
    };

    expect(countOpenAiOutputTokens(event.response.servedModel, content)).toBe(55);
    expect(detectOpenAiTokenRecount(event)).toBeNull();
  });

  it("openai-token-recount-gpt54-residual-only: prices only tokens above framing allowance", () => {
    const content = "hello ".repeat(55).trim();
    const baseEvent = buildCanonicalEvent({
      request: {
        tenantId: "tenant-wave2-openai",
        provider: "openai",
        model: "gpt-5.4-mini",
        requestId: "req-wave2-gpt54-residual",
      },
      response: {
        content,
      },
      usage: {
        input: 10,
        output: 80,
      },
    });
    const event = {
      ...baseEvent,
      response: {
        ...baseEvent.response,
        servedModel: "gpt-5.4-mini-2026-03-17",
      },
    };

    expect(detectOpenAiTokenRecount(event)).toMatchObject({
      code: "OPENAI_TOKEN_RECOUNT_MISMATCH",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      providerRecoverableLossUsd: null,
      evidence: {
        billedOutputTokens: 80,
        billedVisibleOutputTokens: 80,
        recountedVisibleOutputTokens: 55,
        framingAllowanceTokens: 3,
        overBilledOutputTokens: 22,
        outputRateUsdPerMillion: 4.5,
        overchargeUsd: null,
        tokenizerFallbackEstimatedOverchargeUsd: 0.000099,
        tokenizerEncoding: "o200k_base",
        encodingVerified: false,
      },
    });
  });

  it("openai-token-recount-gpt4o-exact: exact verified encodings do not signal", () => {
    const content = "hello ".repeat(55).trim();
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-wave2-openai",
        provider: "openai",
        model: "gpt-4o-mini",
        requestId: "req-wave2-gpt4o-exact",
      },
      response: {
        content,
      },
      usage: {
        input: 10,
        output: 55,
      },
    });

    expect(countOpenAiOutputTokens(event.request.model, content)).toBe(55);
    expect(detectOpenAiTokenRecount(event)).toBeNull();
  });

  it("openai-token-recount-delta-only: emits only the visible output overcharge delta", () => {
    const event = openAiFixtureEvent("openai-chat-clean.json", {
      requestId: "req-wave2-openai-delta",
    });
    const recounted = countOpenAiOutputTokens(event.response.servedModel, event.response.content);
    const overBilledTokens = 50;
    const residualOverBilledTokens = overBilledTokens - 3;
    const overbilledEvent = {
      ...event,
      usage: { ...event.usage, output: recounted + overBilledTokens },
    };

    expect(detectOpenAiTokenRecount(overbilledEvent)).toMatchObject({
      code: "OPENAI_TOKEN_RECOUNT_MISMATCH",
      failureClass: "token_recount_mismatch",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      providerRecoverableLossUsd: null,
      pricingStatus: "priced",
      evidence: {
        billedOutputTokens: recounted + overBilledTokens,
        billedVisibleOutputTokens: recounted + overBilledTokens,
        recountedVisibleOutputTokens: recounted,
        framingAllowanceTokens: 3,
        overBilledOutputTokens: residualOverBilledTokens,
        outputRateUsdPerMillion: 4.5,
        overchargeUsd: null,
        tokenizerFallbackEstimatedOverchargeUsd: 0.000212,
        tokenizerEncoding: "o200k_base",
        encodingVerified: false,
      },
    });
  });

  it("openai-token-recount-reasoning-exclusion: subtracts hidden tokens once", () => {
    const reasoningTokens = 20;
    const event = openAiFixtureEvent("openai-chat-reasoning-output.json", {
      requestId: "req-wave2-reasoning",
      reasoningTokens,
      duplicateProviderReasoningCategory: true,
    });
    const recounted = countOpenAiOutputTokens(event.response.servedModel, event.response.content);
    const visibleOverBilledTokens = 7;
    const output = recounted + reasoningTokens + visibleOverBilledTokens;
    const overbilledEvent = {
      ...event,
      usage: { ...event.usage, output },
    };

    expect(detectOpenAiTokenRecount(overbilledEvent)).toMatchObject({
      providerRecoverableLossUsd: null,
      evidence: {
        billedOutputTokens: output,
        knownHiddenOutputTokens: reasoningTokens,
        billedVisibleOutputTokens: recounted + visibleOverBilledTokens,
        recountedVisibleOutputTokens: recounted,
        framingAllowanceTokens: 3,
        overBilledOutputTokens: visibleOverBilledTokens - 3,
        overchargeUsd: null,
        tokenizerFallbackEstimatedOverchargeUsd: 0.000018,
      },
    });
  });

  it("openai-token-recount-reasoning-only: hidden output tokens do not create a false overcount", () => {
    const reasoningTokens = 20;
    const event = openAiFixtureEvent("openai-chat-reasoning-output.json", {
      requestId: "req-wave2-reasoning-only",
      reasoningTokens,
      duplicateProviderReasoningCategory: true,
    });
    const recounted = countOpenAiOutputTokens(event.response.servedModel, event.response.content);
    const reasoningOnlyEvent = {
      ...event,
      usage: { ...event.usage, output: recounted + reasoningTokens },
    };

    expect(detectOpenAiTokenRecount(reasoningOnlyEvent)).toBeNull();
  });

  it("openai-token-recount-tool-call-skip: skips responses with provider tool calls", () => {
    const event = openAiFixtureEvent("openai-chat-clean.json", {
      requestId: "req-wave2-tool-call-skip",
    });
    const recounted = countOpenAiOutputTokens(event.response.servedModel, event.response.content);

    expect(detectOpenAiTokenRecount({
      ...event,
      response: {
        ...event.response,
        toolCalls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }],
      },
      usage: { ...event.usage, output: recounted + 100 },
    })).toBeNull();
  });

  it("openai-token-recount-multichoice-skip: skips captured n>1 responses", () => {
    const event = openAiFixtureEvent("openai-chat-clean.json", {
      requestId: "req-wave2-multichoice-skip",
    });
    const recounted = countOpenAiOutputTokens(event.response.servedModel, event.response.content);

    expect(detectOpenAiTokenRecount({
      ...event,
      request: {
        ...event.request,
        generation: { n: 2 },
      },
      usage: { ...event.usage, output: recounted + 100 },
    })).toBeNull();
  });

  it("openai-token-recount-refusal-skip: skips native refusal text billed outside content", () => {
    const event = openAiFixtureEvent("openai-chat-clean.json", {
      requestId: "req-wave2-refusal-skip",
    });
    const recounted = countOpenAiOutputTokens(event.response.servedModel, event.response.content);

    expect(detectOpenAiTokenRecount({
      ...event,
      response: {
        ...event.response,
        providerSafety: [{
          kind: "refusal",
          source: "provider",
          reason: "refusal",
          raw: { fieldPath: "choices[0].message.refusal" },
        }],
      },
      usage: { ...event.usage, output: recounted + 100 },
    })).toBeNull();
  });

  it("openai-token-recount-rejected-prediction-exclusion: subtracts rejected prediction tokens from visible output", () => {
    const rejectedPredictionTokens = 30;
    const event = openAiFixtureEvent("openai-chat-clean.json", {
      requestId: "req-wave2-rejected-prediction",
    });
    const recounted = countOpenAiOutputTokens(event.response.servedModel, event.response.content);
    const rejectedPredictionEvent = {
      ...event,
      usage: {
        ...event.usage,
        output: recounted + rejectedPredictionTokens,
        categories: [
          ...event.usage.categories,
          {
            category: "provider:openai:completion_tokens_details.rejected_prediction_tokens",
            tokens: rejectedPredictionTokens,
            sourceField: "completion_tokens_details.rejected_prediction_tokens",
          },
        ],
      },
    };

    expect(detectOpenAiTokenRecount(rejectedPredictionEvent)).toBeNull();
  });

  it("openai-token-recount-recoverable-independent: uses visible-token delta, not full expected cost", () => {
    const reasoningTokens = 20;
    const event = openAiFixtureEvent("openai-chat-reasoning-output.json", {
      requestId: "req-wave2-recount-independent",
      reasoningTokens,
      duplicateProviderReasoningCategory: true,
    });
    const recounted = countOpenAiOutputTokens(event.response.servedModel, event.response.content);
    const visibleOverBilledTokens = 7;
    const residualOverBilledTokens = visibleOverBilledTokens - 3;
    const billedOutputTokens = recounted + reasoningTokens + visibleOverBilledTokens;
    const cacheReadTokens = 20_000;
    const overchargeUsd = tokenUsd(
      residualOverBilledTokens,
      GPT_54_MINI_OUTPUT_RATE_USD_PER_MILLION,
    );
    const observedChargeUsd = roundUsd(
      tokenUsd(event.usage.input, GPT_54_MINI_INPUT_RATE_USD_PER_MILLION) +
        tokenUsd(billedOutputTokens, GPT_54_MINI_OUTPUT_RATE_USD_PER_MILLION) +
        tokenUsd(cacheReadTokens, GPT_54_MINI_CACHE_READ_RATE_USD_PER_MILLION),
    );
    const signal = detectOpenAiTokenRecount({
      ...event,
      usage: {
        ...event.usage,
        output: billedOutputTokens,
        cache: { read: cacheReadTokens, creation: 0 },
      },
    });

    expect(signal).toMatchObject({
      observedChargeUsd,
      expectedChargeUsd: null,
      providerRecoverableLossUsd: null,
      evidence: {
        framingAllowanceTokens: 3,
        overBilledOutputTokens: residualOverBilledTokens,
        outputRateUsdPerMillion: GPT_54_MINI_OUTPUT_RATE_USD_PER_MILLION,
        overchargeUsd: null,
        tokenizerFallbackEstimatedOverchargeUsd: overchargeUsd,
      },
    });
    expect(signal?.providerRecoverableLossUsd).not.toBe(signal?.observedChargeUsd);
  });

  it("anthropic-gross-bound-triage-only: never creates a credit candidate", () => {
    const event = anthropicGrossBoundEvent();
    const crossCheck = crossCheckAnthropicOutputTokens(event);

    expect(buildAnthropicTokenCrossCheckSignal(event, crossCheck)).toMatchObject({
      code: "ANTHROPIC_TOKEN_CROSSCHECK",
      failureClass: "anthropic_token_crosscheck",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      dispute: false,
      providerRecoverableLossUsd: null,
      evidence: {
        overBoundTokens: crossCheck.overBoundTokens,
        disputeEligible: false,
        note: ANTHROPIC_TOKEN_CROSSCHECK_NOTE,
      },
    });
  });

  it("cache-rate-anomaly-delta-only: emits cache overcharge delta from eligible provider evidence", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-wave2-cache",
        provider: "openai",
        model: "gpt-4o-mini",
        requestId: "req-wave2-cache",
      },
      response: { content: "completed" },
      usage: {
        input: 0,
        output: 0,
        cache: { read: 20_000, creation: 0 },
      },
    });
    const observation = fixtureRecord("cache-provider-observation.json");

    expect(buildCacheRateAnomalySignal(event, {
      chargedUsd: 0.01,
      currency: stringField(observation, "currency"),
      source: stringField(observation, "source"),
      observedAt: stringField(observation, "observedAt"),
      dashboardEligible: true,
    })).toMatchObject({
      code: "CACHE_RATE_ANOMALY",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      observedChargeUsd: 0.01,
      expectedChargeUsd: 0.0015,
      providerRecoverableLossUsd: 0.0085,
      evidence: {
        expectedUsd: 0.0015,
        chargedUsd: 0.01,
        overchargeUsd: 0.0085,
        pricingVersion: "pricing-registry-v0",
        pricingSource: "https://developers.openai.com/api/docs/models/gpt-4o-mini",
        source: "provider_usage_api",
      },
    });
  });

  it("cache-rate-anomaly-reasoning-delta: does not inflate expected cost with hidden output tokens", () => {
    const event = openAiFixtureEvent("openai-chat-reasoning-output.json", {
      requestId: "req-wave2-cache-reasoning",
      reasoningTokens: 20,
      duplicateProviderReasoningCategory: true,
    });
    const expectedChargeUsd = roundUsd(
      tokenUsd(event.usage.input, GPT_54_MINI_INPUT_RATE_USD_PER_MILLION) +
        tokenUsd(event.usage.output, GPT_54_MINI_OUTPUT_RATE_USD_PER_MILLION) +
        tokenUsd(20_000, GPT_54_MINI_CACHE_READ_RATE_USD_PER_MILLION),
    );
    const overchargeUsd = roundUsd(0.01 - expectedChargeUsd);
    const signal = buildCacheRateAnomalySignal({
      ...event,
      usage: {
        ...event.usage,
        cache: { read: 20_000, creation: 0 },
      },
    }, {
      chargedUsd: 0.01,
      source: "provider_usage_api",
      dashboardEligible: true,
    });

    expect(signal).toMatchObject({
      expectedChargeUsd,
      providerRecoverableLossUsd: overchargeUsd,
      evidence: {
        expectedUsd: expectedChargeUsd,
        chargedUsd: 0.01,
        overchargeUsd,
      },
    });
  });

  it("cache-rate-anomaly-anthropic-ttl-write-split: prices 5m and 1h cache writes separately", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-wave2-cache",
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        requestId: "req-wave2-cache-ttl-write",
      },
      response: { content: "completed" },
      usage: {
        input: 10,
        output: 8,
        cache: { read: 0, creation: 5 },
        categories: [
          {
            category: "provider:anthropic:cache_creation.ephemeral_5m_input_tokens",
            tokens: 2,
            sourceField: "cache_creation.ephemeral_5m_input_tokens",
          },
          {
            category: "provider:anthropic:cache_creation.ephemeral_1h_input_tokens",
            tokens: 3,
            sourceField: "cache_creation.ephemeral_1h_input_tokens",
          },
        ],
      },
    });

    expect(buildCacheRateAnomalySignal(event, {
      chargedUsd: 0.0001,
      source: "provider_usage_api",
      dashboardEligible: true,
    })).toMatchObject({
      code: "CACHE_RATE_ANOMALY",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      expectedChargeUsd: 0.000059,
      providerRecoverableLossUsd: 0.000041,
      evidence: {
        cacheReadTokens: 0,
        cacheCreationTokens: 5,
        expectedUsd: 0.000059,
        chargedUsd: 0.0001,
        overchargeUsd: 0.000041,
        pricingComponents: [
          expect.objectContaining({ category: "input", quantity: 10, rateUsdPerMillion: 1 }),
          expect.objectContaining({ category: "output", quantity: 8, rateUsdPerMillion: 5 }),
          expect.objectContaining({
            category: "anthropic_cache_creation_5m",
            quantity: 2,
            rateUsdPerMillion: 1.25,
          }),
          expect.objectContaining({
            category: "anthropic_cache_creation_1h",
            quantity: 3,
            rateUsdPerMillion: 2,
          }),
        ],
      },
    });
  });

  it("cache-rate-anomaly-ineligible: direct non-provider observations cannot reach recoverable dollars", () => {
    const event = buildCanonicalEvent({
      request: {
        tenantId: "tenant-wave2-cache",
        provider: "openai",
        model: "gpt-4o-mini",
        requestId: "req-wave2-cache-ineligible",
      },
      response: { content: "completed" },
      usage: {
        input: 0,
        output: 0,
        cache: { read: 20_000, creation: 0 },
      },
    });

    expect(buildCacheRateAnomalySignal(event, {
      chargedUsd: 0.01,
      source: "manual_admin",
      dashboardEligible: false,
    })).toMatchObject({
      code: "CACHE_RATE_ANOMALY",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      providerRecoverableLossUsd: null,
    });
  });
});

interface OpenAiFixtureOptions {
  readonly requestId: string;
  readonly reasoningTokens?: number;
  readonly duplicateProviderReasoningCategory?: boolean;
}

function openAiFixtureEvent(
  name: string,
  options: OpenAiFixtureOptions,
): CanonicalEventNormalized {
  const payload = fixtureRecord(name);
  const usage = recordField(payload, "usage");
  const content = openAiContent(payload);
  const model = stringField(payload, "model");
  const promptTokens = numberField(usage, "prompt_tokens");
  const completionTokens = numberField(usage, "completion_tokens");
  return normalizeCanonicalEvent({
    schemaVersion: "v2",
    request: {
      tenantId: "tenant-wave2-openai",
      provider: "openai",
      requestId: options.requestId,
      requestedModel: "gpt-5.4-mini",
      model: "gpt-5.4-mini",
      attemptIndex: 0,
      expectCompletion: true,
    },
    response: {
      statusCode: 200,
      finishReason: "stop",
      content,
      servedModel: model,
      providerResponseId: stringField(payload, "id"),
    },
    usage: {
      input: promptTokens,
      output: completionTokens,
      raw: usage,
      categories: openAiCategories(usage, options.reasoningTokens, options.duplicateProviderReasoningCategory),
      usageSource: "provider",
    },
    timing: timingV2("2026-06-14T12:00:00.000Z"),
    attempts: [{
      attemptNumber: 0,
      provider: "openai",
      model,
      status: "success",
      timing: attemptTiming("2026-06-14T12:00:00.000Z"),
      finalSelected: true,
    }],
  } satisfies CanonicalEventV2);
}

function anthropicGrossBoundEvent(): CanonicalEventNormalized {
  const payload = fixtureRecord("anthropic-message-gross-bound.json");
  const usage = recordField(payload, "usage");
  const content = textFromAnthropicContent(payload.content);
  const model = stringField(payload, "model");
  return normalizeCanonicalEvent({
    schemaVersion: "v2",
    request: {
      tenantId: "tenant-wave2-anthropic",
      provider: "anthropic",
      requestId: "req-wave2-anthropic",
      requestedModel: model,
      model,
      attemptIndex: 0,
    },
    response: {
      statusCode: 200,
      finishReason: stringField(payload, "stop_reason"),
      content,
      servedModel: model,
    },
    usage: {
      input: numberField(usage, "input_tokens"),
      output: numberField(usage, "output_tokens"),
      raw: usage,
      categories: [
        { category: "input", tokens: numberField(usage, "input_tokens") },
        { category: "output", tokens: numberField(usage, "output_tokens") },
      ],
      usageSource: "provider",
    },
    timing: timingV2("2026-06-14T12:00:00.000Z"),
    attempts: [{
      attemptNumber: 0,
      provider: "anthropic",
      model,
      status: "success",
      timing: attemptTiming("2026-06-14T12:00:00.000Z"),
      finalSelected: true,
    }],
  } satisfies CanonicalEventV2);
}

function openAiCategories(
  usage: Record<string, unknown>,
  reasoningTokens = 0,
  duplicateProviderReasoningCategory = false,
): CanonicalUsageCategory[] {
  return [
    { category: "prompt", tokens: numberField(usage, "prompt_tokens"), sourceField: "prompt_tokens" },
    { category: "completion", tokens: numberField(usage, "completion_tokens"), sourceField: "completion_tokens" },
    ...(reasoningTokens > 0
      ? [{ category: "reasoning", tokens: reasoningTokens, sourceField: "completion_tokens_details.reasoning_tokens" }]
      : []),
    ...(duplicateProviderReasoningCategory
      ? [{
          category: "provider:openai:completion_tokens_details.reasoning_tokens",
          tokens: reasoningTokens,
          sourceField: "completion_tokens_details.reasoning_tokens",
        }]
      : []),
  ];
}

function openAiContent(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : {};
  const message = recordField(firstChoice, "message");
  return stringField(message, "content");
}

function textFromAnthropicContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((item) => isRecord(item) && typeof item.text === "string" ? [item.text] : [])
    .join("");
}

function fixtureRecord(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (!isRecord(parsed)) throw new Error(`Fixture ${name} must be an object.`);
  return parsed;
}

function recordField(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = record[field];
  if (!isRecord(value)) throw new Error(`Expected ${field} object.`);
  return value;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") throw new Error(`Expected ${field} string.`);
  return value;
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== "number") throw new Error(`Expected ${field} number.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function attemptTiming(startedAt: string) {
  const started = new Date(startedAt);
  return {
    startedAt,
    endedAt: new Date(started.getTime() + 1_000).toISOString(),
    latencyMs: 1_000,
  };
}

function timingV2(startedAt: string) {
  return {
    ...attemptTiming(startedAt),
    chunkCount: 0,
    terminalStatus: "complete" as const,
  };
}

function tokenUsd(tokens: number, rateUsdPerMillion: number): number {
  return (tokens * rateUsdPerMillion) / 1_000_000;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
