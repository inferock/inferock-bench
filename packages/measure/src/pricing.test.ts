import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { CanonicalEventV1 } from "./canonical-event.js";
import {
  GEMINI_DEVELOPER_API_PLANE,
  OPENROUTER_PLANE,
  clearModelPricing,
  estimateCostUsd,
  listModelPricingRegistryEntries,
  listPricedModelOptions,
  listStaticRoutedModelOptions,
  lookupPrice,
  lookupPriceForEvent,
  lookupPriceForEventModel,
  registerDefaultModelPricing,
  registerModelPricing,
} from "./pricing.js";

describe("pricing", () => {
  afterEachPricingReset();

  it("lookup-price-known-model-components: returns versioned per-category USD components", () => {
    const result = lookupPrice({
      provider: "openai",
      model: "gpt-5.4-mini",
      eventTime: "2026-06-14T12:00:00.000Z",
      usage: {
        input: 200,
        output: 100,
        cache: { read: 800 },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      pricingVersion: "pricing-registry-v0",
      currency: "USD",
      pricingStatus: "priced",
      expectedChargeUsd: 0.00066,
    });
    expect(result.ok && result.components).toEqual([
      {
        category: "input",
        quantity: 200,
        unit: "tokens",
        rateUsdPerMillion: 0.75,
        chargeUsd: 0.00015,
        pricingStatus: "priced",
      },
      {
        category: "output",
        quantity: 100,
        unit: "tokens",
        rateUsdPerMillion: 4.5,
        chargeUsd: 0.00045,
        pricingStatus: "priced",
      },
      {
        category: "cache_read",
        quantity: 800,
        unit: "tokens",
        rateUsdPerMillion: 0.07500000000000001,
        chargeUsd: 0.00006,
        pricingStatus: "priced",
      },
    ]);
  });

  it("lookup-price-openai-reasoning-informational: does not double-price hidden output tokens", () => {
    const result = lookupPrice({
      provider: "openai",
      model: "gpt-5.4-mini",
      eventTime: "2026-06-14T12:00:00.000Z",
      usage: {
        input: 0,
        output: 42,
        categories: [
          { category: "completion", tokens: 42 },
          { category: "reasoning", tokens: 20 },
          {
            category: "provider:openai:completion_tokens_details.reasoning_tokens",
            tokens: 20,
          },
          {
            category: "provider:openai:output_tokens_details.reasoning_tokens",
            tokens: 20,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      pricingStatus: "priced",
      expectedChargeUsd: 0.000189,
    });
    expect(result.ok && result.components).toEqual([
      {
        category: "output",
        quantity: 42,
        unit: "tokens",
        rateUsdPerMillion: 4.5,
        chargeUsd: 0.000189,
        pricingStatus: "priced",
      },
    ]);
  });

  it("lookup-price-openai-responses-provider-categories: dedupes Responses capture categories", () => {
    const result = lookupPrice({
      provider: "openai",
      model: "gpt-4o-mini-2024-07-18",
      eventTime: "2026-07-04T12:00:00.000Z",
      usage: {
        input: 10,
        output: 5,
        categories: [
          { category: "input", tokens: 10, sourceField: "input_tokens" },
          { category: "output", tokens: 5, sourceField: "output_tokens" },
          { category: "provider:openai_responses:input_tokens", tokens: 10, sourceField: "input_tokens" },
          { category: "provider:openai_responses:output_tokens", tokens: 5, sourceField: "output_tokens" },
          { category: "provider:openai_responses:total_tokens", tokens: 15, sourceField: "total_tokens" },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      pricingStatus: "priced",
      expectedChargeUsd: 0.000005,
    });
    expect(result.ok && result.components.map((component) => component.category)).toEqual(["input", "output"]);
  });

  it("lookup-price-openai-rejected-prediction-informational: does not price rejected prediction tokens twice", () => {
    const result = lookupPrice({
      provider: "openai",
      model: "gpt-5.4-mini",
      eventTime: "2026-06-14T12:00:00.000Z",
      usage: {
        input: 0,
        output: 42,
        categories: [
          { category: "completion", tokens: 42 },
          {
            category: "provider:openai:completion_tokens_details.rejected_prediction_tokens",
            tokens: 20,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      pricingStatus: "priced",
      expectedChargeUsd: 0.000189,
    });
    expect(result.ok && result.components).toEqual([
      {
        category: "output",
        quantity: 42,
        unit: "tokens",
        rateUsdPerMillion: 4.5,
        chargeUsd: 0.000189,
        pricingStatus: "priced",
      },
    ]);
  });

  it("lookup-price-anthropic-thinking-and-ttl-split: prices Wave A TTL cache creation categories separately", () => {
    const result = lookupPrice({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      eventTime: "2026-06-14T12:00:00.000Z",
      usage: {
        input: 10,
        output: 8,
        cache: { creation: 5 },
        categories: [
          { category: "reasoning", tokens: 3, sourceField: "output_tokens_details.thinking_tokens" },
          {
            category: "provider:anthropic:output_tokens_details.thinking_tokens",
            tokens: 3,
            sourceField: "output_tokens_details.thinking_tokens",
          },
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

    expect(result).toMatchObject({
      ok: true,
      pricingStatus: "priced",
      expectedChargeUsd: 0.000059,
    });
    expect(result.ok && result.components).toEqual([
      {
        category: "input",
        quantity: 10,
        unit: "tokens",
        rateUsdPerMillion: 1,
        chargeUsd: 0.00001,
        pricingStatus: "priced",
      },
      {
        category: "output",
        quantity: 8,
        unit: "tokens",
        rateUsdPerMillion: 5,
        chargeUsd: 0.00004,
        pricingStatus: "priced",
      },
      {
        category: "anthropic_cache_creation_5m",
        quantity: 2,
        unit: "tokens",
        rateUsdPerMillion: 1.25,
        chargeUsd: 0.000003,
        pricingStatus: "priced",
      },
      {
        category: "anthropic_cache_creation_1h",
        quantity: 3,
        unit: "tokens",
        rateUsdPerMillion: 2,
        chargeUsd: 0.000006,
        pricingStatus: "priced",
      },
    ]);
  });

  it("lookup-price-unknown-model: returns pricing_unknown instead of a silent zero", () => {
    const result = lookupPrice({
      provider: "openai",
      model: "unknown-model",
      eventTime: "2026-06-14T12:00:00.000Z",
      usage: {
        input: 1_000,
        output: 500,
      },
    });

    expect(result).toEqual({
      ok: false,
      reason: "pricing_unknown",
      provider: "openai",
      model: "unknown-model",
      usageCategories: ["input", "output"],
    });
  });

  it("lookup-price-unlisted-current-family-alias: keeps unpriced aliases pricing_unknown", () => {
    const cases = [
      { provider: "openai" as const, model: "gpt-5" },
      { provider: "openai" as const, model: "gpt-5-mini" },
      { provider: "openai" as const, model: "gpt-5-nano" },
      { provider: "anthropic" as const, model: "claude-mythos-preview" },
    ];

    for (const testCase of cases) {
      expect(lookupPrice({
        provider: testCase.provider,
        model: testCase.model,
        eventTime: "2026-07-02T00:00:00.000Z",
        usage: {
          input: 1_000,
          output: 500,
        },
      })).toEqual({
        ok: false,
        reason: "pricing_unknown",
        provider: testCase.provider,
        model: testCase.model,
        usageCategories: ["input", "output"],
      });
    }
  });

  it("lookup-price-partial: excludes hidden output categories from partial pricing", () => {
    clearModelPricing();
    registerModelPricing({
      provider: "openai",
      model: "partial-model",
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 2,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2027-01-01T00:00:00.000Z",
      source: "test partial model",
      pricingVersion: "test-registry",
    });

    const result = lookupPrice({
      provider: "openai",
      model: "partial-model",
      eventTime: "2026-06-14T12:00:00.000Z",
      usage: {
        input: 100,
        output: 0,
        categories: [{ category: "reasoning", tokens: 50 }],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      pricingStatus: "priced",
      expectedChargeUsd: 0.0001,
    });
    expect(result.ok && result.components).toEqual([
      {
        category: "input",
        quantity: 100,
        unit: "tokens",
        rateUsdPerMillion: 1,
        chargeUsd: 0.0001,
        pricingStatus: "priced",
      },
    ]);
  });

  it("lookup-price-partial-tool: surfaces unpriced tool usage without charging zero silently", () => {
    expectPartialUnpricedCategory("tool");
  });

  it("lookup-price-partial-audio: surfaces unpriced audio usage without charging zero silently", () => {
    expectPartialUnpricedCategory("audio");
  });

  it("lookup-price-partial-provider-specific: surfaces unpriced provider usage without charging zero silently", () => {
    expectPartialUnpricedCategory("provider:openai:responses.usage.new_billed_tokens");
  });

  it("lookup-price-effective-range: prices by event time instead of latest entry", () => {
    clearModelPricing();
    registerModelPricing({
      provider: "openai",
      model: "range-model",
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 1,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-06-01T00:00:00.000Z",
      source: "test old price",
      pricingVersion: "test-old",
    });
    registerModelPricing({
      provider: "openai",
      model: "range-model",
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 3,
      effectiveFrom: "2026-06-01T00:00:00.000Z",
      effectiveTo: "2026-12-31T00:00:00.000Z",
      source: "test new price",
      pricingVersion: "test-new",
    });

    const oldPrice = lookupPrice({
      provider: "openai",
      model: "range-model",
      eventTime: "2026-05-31T23:59:59.000Z",
      usage: { input: 1_000, output: 0 },
    });
    const newPrice = lookupPrice({
      provider: "openai",
      model: "range-model",
      eventTime: "2026-06-01T00:00:00.000Z",
      usage: { input: 1_000, output: 0 },
    });
    const outsideRange = lookupPrice({
      provider: "openai",
      model: "range-model",
      eventTime: "2027-01-01T00:00:00.000Z",
      usage: { input: 1_000, output: 0 },
    });

    expect(oldPrice).toMatchObject({ ok: true, expectedChargeUsd: 0.001 });
    expect(newPrice).toMatchObject({ ok: true, expectedChargeUsd: 0.003 });
    expect(outsideRange).toEqual({
      ok: false,
      reason: "pricing_unknown",
      provider: "openai",
      model: "range-model",
      usageCategories: ["input"],
    });
  });

  it("lookup-price-v1-event: keeps legacy events priced through the same API", () => {
    const event = canonicalEvent({
      provider: "openai",
      model: "gpt-5.4-mini",
      usage: {
        input: 1_000,
        output: 100,
      },
    });

    expect(estimateCostUsd(event)).toBe(0.0012);
  });

  it("lookup-price-current-family-models: resolves verified current-generation entries", () => {
    const cases = [
      {
        provider: "openai" as const,
        model: "gpt-5.5",
        eventTime: "2026-07-02T00:00:00.000Z",
        expectedChargeUsd: 0.008,
      },
      {
        provider: "anthropic" as const,
        model: "claude-opus-4-8",
        eventTime: "2026-07-02T00:00:00.000Z",
        expectedChargeUsd: 0.0075,
      },
      {
        provider: "anthropic" as const,
        model: "claude-fable-5",
        eventTime: "2026-07-02T00:00:00.000Z",
        expectedChargeUsd: 0.015,
      },
      {
        provider: "anthropic" as const,
        model: "claude-mythos-5",
        eventTime: "2026-07-02T00:00:00.000Z",
        expectedChargeUsd: 0.015,
      },
      {
        provider: "anthropic" as const,
        model: "claude-sonnet-4-6-20260514",
        eventTime: "2026-07-02T00:00:00.000Z",
        expectedChargeUsd: 0.0045,
      },
      {
        provider: "anthropic" as const,
        model: "claude-sonnet-5",
        eventTime: "2026-08-31T23:59:59.000Z",
        expectedChargeUsd: 0.003,
      },
      {
        provider: "anthropic" as const,
        model: "claude-sonnet-5",
        eventTime: "2026-09-01T00:00:00.000Z",
        expectedChargeUsd: 0.0045,
      },
    ];

    for (const testCase of cases) {
      expect(lookupPrice({
        provider: testCase.provider,
        model: testCase.model,
        eventTime: testCase.eventTime,
        usage: {
          input: 1_000,
          output: 100,
        },
      })).toMatchObject({
        ok: true,
        pricingStatus: "priced",
        expectedChargeUsd: testCase.expectedChargeUsd,
      });
    }
  });

  it("lookup-price-openai-embedding-model: prices the drift embedding route as input-only", () => {
    expect(lookupPrice({
      provider: "openai",
      model: "text-embedding-3-small",
      eventTime: "2026-07-05T00:00:00.000Z",
      usage: {
        input: 1_000,
        output: 0,
      },
    })).toMatchObject({
      ok: true,
      pricingStatus: "priced",
      expectedChargeUsd: 0.00002,
      sourceRetrievedAt: "2026-07-05",
    });
  });

  it("lookup-price-anthropic-cache-ttl: prices cache read and 5m/1h creation at distinct rates", () => {
    const result = lookupPrice({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      eventTime: "2026-06-14T12:00:00.000Z",
      usage: {
        input: 0,
        output: 0,
        categories: [
          { category: "cached", tokens: 1_000 },
          { category: "anthropic_cache_creation_5m", tokens: 1_000 },
          { category: "anthropic_cache_creation_1h", tokens: 1_000 },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      pricingStatus: "priced",
      expectedChargeUsd: 0.00335,
    });
    expect(result.ok && result.components.map((component) => ({
      category: component.category,
      rateUsdPerMillion: component.rateUsdPerMillion,
    }))).toEqual([
      { category: "cache_read", rateUsdPerMillion: 0.1 },
      { category: "anthropic_cache_creation_5m", rateUsdPerMillion: 1.25 },
      { category: "anthropic_cache_creation_1h", rateUsdPerMillion: 2 },
    ]);
  });

  it("pricing-openai-current-gen-cache-hit-cost: prices current cached input at 10 percent", () => {
    const result = lookupPrice({
      provider: "openai",
      model: "gpt-5.4",
      eventTime: "2026-07-02T00:00:00.000Z",
      usage: {
        input: 1_000,
        output: 100,
        cache: { read: 1_000 },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      pricingStatus: "priced",
      expectedChargeUsd: 0.00425,
    });
    expect(result.ok && result.components.map((component) => ({
      category: component.category,
      rateUsdPerMillion: component.rateUsdPerMillion,
    }))).toEqual([
      { category: "input", rateUsdPerMillion: 2.5 },
      { category: "output", rateUsdPerMillion: 15 },
      { category: "cache_read", rateUsdPerMillion: 0.25 },
    ]);
  });

  it("pricing-openai-pro-no-cached-price: surfaces cached input as partial for pro models", () => {
    const result = lookupPrice({
      provider: "openai",
      model: "gpt-5.4-pro",
      eventTime: "2026-07-02T00:00:00.000Z",
      usage: {
        input: 1_000,
        output: 100,
        cache: { read: 1_000 },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      pricingStatus: "partial",
      expectedChargeUsd: 0.048,
    });
    expect(result.ok && result.components).toContainEqual({
      category: "cache_read",
      quantity: 1_000,
      unit: "tokens",
      rateUsdPerMillion: null,
      chargeUsd: null,
      pricingStatus: "unpriced",
    });
  });

  it("pricing-openai-cache-hit-cost: charges cached prompt tokens only at cache-read rate", () => {
    const promptTokens = 1_000;
    const cachedTokens = 800;
    const completionTokens = 100;
    const event = canonicalEvent({
      provider: "openai",
      model: "gpt-5.4-mini",
      usage: {
        input: promptTokens - cachedTokens,
        output: completionTokens,
        cache: { read: cachedTokens },
      },
    });

    expect(estimateCostUsd(event)).toBe(0.00066);
    expect(estimateCostUsd(event)).not.toBe(0.0012);
  });

  it("pricing-openai-no-cache-unchanged: keeps full prompt cost when cached tokens are zero", () => {
    const withZeroCache = canonicalEvent({
      provider: "openai",
      model: "gpt-5.4-mini",
      usage: {
        input: 1_000,
        output: 100,
        cache: { read: 0 },
      },
    });
    const withoutCache = canonicalEvent({
      provider: "openai",
      model: "gpt-5.4-mini",
      usage: {
        input: 1_000,
        output: 100,
      },
    });

    expect(estimateCostUsd(withZeroCache)).toBe(0.0012);
    expect(estimateCostUsd(withZeroCache)).toBe(estimateCostUsd(withoutCache));
  });

  it("pricing-openai-unmodeled-dimensions-fixtures: keeps service tier, batch, plane, and long-context pricing unknown", () => {
    const fixture = readJsonFixture("openai-chat-priority-tier.json");
    const usage = recordField(fixture, "usage");
    const promptTokens = numberField(usage, "prompt_tokens");
    const completionTokens = numberField(usage, "completion_tokens");
    const cachedTokens = numberField(recordField(usage, "prompt_tokens_details"), "cached_tokens");
    const serviceTier = stringField(fixture, "service_tier");
    const model = stringField(fixture, "model");
    const recordedUsage = {
      input: promptTokens - cachedTokens,
      output: completionTokens,
      cache: { read: cachedTokens },
    };

    expect(lookupPriceForEvent(canonicalEvent({
      provider: "openai",
      model,
      usage: recordedUsage,
      response: { serviceTier },
    }))).toEqual({
      ok: false,
      reason: "pricing_unknown",
      provider: "openai",
      model,
      usageCategories: ["input", "output", "cache_read"],
    });
    expect(lookupPriceForEvent(canonicalEvent({
      provider: "openai",
      model,
      usage: recordedUsage,
      request: { workloadClass: "batch" },
    }))).toEqual({
      ok: false,
      reason: "pricing_unknown",
      provider: "openai",
      model,
      usageCategories: ["input", "output", "cache_read"],
    });
    expect(lookupPriceForEvent(canonicalEvent({
      provider: "openai",
      model,
      usage: recordedUsage,
      request: { providerPlane: "openai_data_residency_us" },
    }))).toEqual({
      ok: false,
      reason: "pricing_unknown",
      provider: "openai",
      model,
      usageCategories: ["input", "output", "cache_read"],
    });
    expect(lookupPriceForEvent(canonicalEvent({
      provider: "openai",
      model,
      usage: recordedUsage,
      request: { generation: { contextTier: "long_context" } },
    }))).toEqual({
      ok: false,
      reason: "pricing_unknown",
      provider: "openai",
      model,
      usageCategories: ["input", "output", "cache_read"],
    });
  });

  it("pricing-anthropic-geo-fixture: keeps US inference geo pricing unknown without a cited multiplier row", () => {
    const fixture = readJsonFixture("anthropic-message-us-inference-geo.json");
    const usage = recordField(fixture, "usage");
    const model = stringField(fixture, "model");
    const event = canonicalEvent({
      provider: "anthropic",
      model,
      usage: {
        input: numberField(usage, "input_tokens"),
        output: numberField(usage, "output_tokens"),
        inferenceGeo: stringField(usage, "inference_geo"),
      },
    });

    expect(lookupPriceForEvent(event)).toEqual({
      ok: false,
      reason: "pricing_unknown",
      provider: "anthropic",
      model,
      usageCategories: ["input", "output"],
    });
  });

  it("pricing-gemini-developer-api-standard: prices cache reads and thinking tokens once", () => {
    const result = lookupPrice({
      provider: "gemini",
      model: "gemini-2.5-flash",
      plane: GEMINI_DEVELOPER_API_PLANE,
      eventTime: "2026-07-06T00:00:00.000Z",
      usage: {
        input: 80,
        output: 12,
        cache: { read: 40 },
        serviceTier: "standard",
        categories: [
          { category: "input", tokens: 80, sourceField: "promptTokenCount - cachedContentTokenCount" },
          { category: "output", tokens: 12, sourceField: "candidatesTokenCount" },
          { category: "cache_read", tokens: 40, sourceField: "cachedContentTokenCount" },
          { category: "gemini_thinking", tokens: 5, sourceField: "thoughtsTokenCount" },
          {
            category: "provider:gemini:toolUsePromptTokenCount",
            tokens: 7,
            sourceField: "toolUsePromptTokenCount",
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      pricingStatus: "priced",
      expectedChargeUsd: 0.000068,
      source: "https://ai.google.dev/gemini-api/docs/pricing",
      sourceRetrievedAt: "2026-07-06",
    });
    expect(result.ok && result.components).toEqual([
      {
        category: "input",
        quantity: 80,
        unit: "tokens",
        rateUsdPerMillion: 0.30,
        chargeUsd: 0.000024,
        pricingStatus: "priced",
      },
      {
        category: "output",
        quantity: 12,
        unit: "tokens",
        rateUsdPerMillion: 2.50,
        chargeUsd: 0.00003,
        pricingStatus: "priced",
      },
      {
        category: "cache_read",
        quantity: 40,
        unit: "tokens",
        rateUsdPerMillion: 0.03,
        chargeUsd: 0.000001,
        pricingStatus: "priced",
      },
      {
        category: "gemini_thinking",
        quantity: 5,
        unit: "tokens",
        rateUsdPerMillion: 2.50,
        chargeUsd: 0.000013,
        pricingStatus: "priced",
      },
    ]);
  });

  it("pricing-gemini-prompt-threshold: selects 200k prompt-token tiers", () => {
    const atThreshold = lookupPrice({
      provider: "gemini",
      model: "gemini-2.5-pro",
      plane: GEMINI_DEVELOPER_API_PLANE,
      eventTime: "2026-07-06T00:00:00.000Z",
      usage: {
        input: 199_900,
        output: 1,
        cache: { read: 100 },
      },
    });
    const aboveThreshold = lookupPrice({
      provider: "gemini",
      model: "gemini-2.5-pro",
      plane: GEMINI_DEVELOPER_API_PLANE,
      eventTime: "2026-07-06T00:00:00.000Z",
      usage: {
        input: 199_901,
        output: 1,
        cache: { read: 100 },
      },
    });

    expect(atThreshold.ok && atThreshold.components[0]).toMatchObject({
      category: "input",
      rateUsdPerMillion: 1.25,
    });
    expect(atThreshold.ok && atThreshold.components[1]).toMatchObject({
      category: "output",
      rateUsdPerMillion: 10,
    });
    expect(aboveThreshold.ok && aboveThreshold.components[0]).toMatchObject({
      category: "input",
      rateUsdPerMillion: 2.50,
    });
    expect(aboveThreshold.ok && aboveThreshold.components[1]).toMatchObject({
      category: "output",
      rateUsdPerMillion: 15,
    });
  });

  it("pricing-gemini-service-tier-and-plane: exposes Developer API plane and service tiers", () => {
    const flex = lookupPrice({
      provider: "gemini",
      model: "gemini-3.5-flash",
      plane: GEMINI_DEVELOPER_API_PLANE,
      eventTime: "2026-07-06T00:00:00.000Z",
      usage: {
        input: 10,
        output: 10,
        cache: { read: 100 },
        serviceTier: "flex",
      },
    });
    const priority = lookupPrice({
      provider: "gemini",
      model: "gemini-3.5-flash",
      plane: GEMINI_DEVELOPER_API_PLANE,
      eventTime: "2026-07-06T00:00:00.000Z",
      usage: {
        input: 10,
        output: 10,
        cache: { read: 100 },
        serviceTier: "priority",
      },
    });
    const registryEntries = listModelPricingRegistryEntries()
      .filter((entry) => entry.provider === "gemini");

    expect(flex.ok && flex.components).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: "cache_read",
        rateUsdPerMillion: 0.08,
      }),
    ]));
    expect(priority.ok && priority.components[0]).toMatchObject({
      category: "input",
      rateUsdPerMillion: 2.70,
    });
    expect(registryEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        model: "gemini-3.5-flash",
        plane: "gemini_developer_api",
        serviceTiers: ["flex"],
        source: "https://ai.google.dev/gemini-api/docs/pricing",
        sourceRetrievedAt: "2026-07-06",
      }),
      expect.objectContaining({
        model: "gemini-2.5-pro",
        plane: "gemini_developer_api",
        promptTokenMaxInclusive: 200_000,
      }),
      expect.objectContaining({
        model: "gemini-2.5-pro",
        plane: "gemini_developer_api",
        promptTokenMinExclusive: 200_000,
      }),
    ]));
  });

  it("pricing-gemini-plane-required-and-models-prefix: requires Developer API plane and canonicalizes resource names", () => {
    const withoutPlane = lookupPrice({
      provider: "gemini",
      model: "gemini-2.5-flash",
      eventTime: "2026-07-06T00:00:00.000Z",
      usage: {
        input: 10,
        output: 1,
      },
    });
    const withResourceName = lookupPrice({
      provider: "gemini",
      model: "models/gemini-2.5-flash",
      plane: GEMINI_DEVELOPER_API_PLANE,
      eventTime: "2026-07-06T00:00:00.000Z",
      usage: {
        input: 10,
        output: 1,
      },
    });

    expect(withoutPlane).toEqual({
      ok: false,
      reason: "pricing_unknown",
      provider: "gemini",
      model: "gemini-2.5-flash",
      usageCategories: ["input", "output"],
    });
    expect(withResourceName).toMatchObject({
      ok: true,
      pricingStatus: "priced",
      expectedChargeUsd: 0.000006,
    });
  });

  it("pricing-gemini-audio-modality: prices audio input and audio cache reads from usage categories", () => {
    const result = lookupPrice({
      provider: "gemini",
      model: "gemini-2.5-flash",
      plane: GEMINI_DEVELOPER_API_PLANE,
      eventTime: "2026-07-06T00:00:00.000Z",
      usage: {
        input: 80,
        output: 0,
        cache: { read: 20 },
        categories: [
          { category: "audio_input", tokens: 30, sourceField: "promptTokensDetails[AUDIO] - cacheTokensDetails[AUDIO]" },
          { category: "audio_cache_read", tokens: 10, sourceField: "cacheTokensDetails[AUDIO]" },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      pricingStatus: "priced",
      expectedChargeUsd: 0.000046,
    });
    expect(result.ok && result.components).toEqual([
      expect.objectContaining({ category: "input", quantity: 50, rateUsdPerMillion: 0.30 }),
      expect.objectContaining({ category: "cache_read", quantity: 10, rateUsdPerMillion: 0.03 }),
      expect.objectContaining({ category: "audio_input", quantity: 30, rateUsdPerMillion: 1.00 }),
      expect.objectContaining({ category: "audio_cache_read", quantity: 10, rateUsdPerMillion: 0.10 }),
    ]);
  });

  it("pricing-gemini-thinking-consistency: prices only reconciled thinking categories", () => {
    const reconciled = lookupPrice({
      provider: "gemini",
      model: "gemini-2.5-flash",
      plane: GEMINI_DEVELOPER_API_PLANE,
      eventTime: "2026-07-06T00:00:00.000Z",
      usage: {
        input: 0,
        output: 0,
        categories: [{ category: "gemini_thinking", tokens: 5, sourceField: "thoughtsTokenCount" }],
      },
    });
    const unverified = lookupPrice({
      provider: "gemini",
      model: "gemini-2.5-flash",
      plane: GEMINI_DEVELOPER_API_PLANE,
      eventTime: "2026-07-06T00:00:00.000Z",
      usage: {
        input: 0,
        output: 0,
        categories: [{ category: "gemini_thinking_unverified", tokens: 5, sourceField: "thoughtsTokenCount" }],
      },
    });

    expect(reconciled).toMatchObject({
      ok: true,
      pricingStatus: "priced",
      expectedChargeUsd: 0.000013,
    });
    expect(unverified).toMatchObject({
      ok: true,
      pricingStatus: "partial",
      expectedChargeUsd: 0,
    });
    expect(unverified.ok && unverified.components).toEqual([
      expect.objectContaining({
        category: "gemini_thinking_unverified",
        quantity: 5,
        rateUsdPerMillion: null,
        chargeUsd: null,
        pricingStatus: "unpriced",
      }),
    ]);
  });

  it("pricing-oss-frontier-cited-rows: prices cited OSS first-party rows and leaves unknown cache categories unpriced", () => {
    const plainRows = [
      {
        provider: "mistral" as const,
        model: "mistral-large-2512",
        expectedChargeUsd: 0.00065,
        source: "https://docs.mistral.ai/models/model-cards/mistral-large-3-25-12",
      },
      {
        provider: "deepseek_platform" as const,
        model: "deepseek-v4-pro",
        expectedChargeUsd: 0.000522,
        source: "https://api-docs.deepseek.com/quick_start/pricing",
      },
      {
        provider: "deepinfra" as const,
        model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        expectedChargeUsd: 0.00021,
        source: "https://deepinfra.com/pricing",
      },
      {
        provider: "alibaba_dashscope_us_virginia" as const,
        model: "qwen3-235b-a22b-instruct-2507",
        expectedChargeUsd: 0.000322,
        source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      },
      {
        provider: "moonshot_kimi" as const,
        model: "kimi-k2.7-code",
        expectedChargeUsd: 0.00135,
        source: "https://platform.kimi.ai/docs/pricing/chat-k27-code",
      },
      {
        provider: "zai" as const,
        model: "glm-5.2",
        expectedChargeUsd: 0.00184,
        source: "https://docs.z.ai/guides/overview/pricing",
      },
    ];

    for (const row of plainRows) {
      expect(lookupPrice({
        provider: row.provider,
        model: row.model,
        eventTime: "2026-07-06T00:00:00.000Z",
        usage: { input: 1_000, output: 100 },
      })).toMatchObject({
        ok: true,
        pricingStatus: "priced",
        expectedChargeUsd: row.expectedChargeUsd,
        source: row.source,
        sourceRetrievedAt: "2026-07-06",
      });
    }

    expect(lookupPrice({
      provider: "mistral",
      model: "mistral-large-2512",
      eventTime: "2026-07-06T00:00:00.000Z",
      usage: { input: 1_000, output: 100, cache: { read: 100 } },
    })).toMatchObject({
      ok: true,
      pricingStatus: "partial",
    });
  });

  it("pricing-openrouter-endpoint-rows: prices cited OpenRouter rows only when the observed endpoint plane is known", () => {
    const rows = [
      {
        model: "meta-llama/llama-4-maverick",
        pinnedProvider: "parasail/fp8",
        expectedChargeUsd: 0.00045,
        source: "https://openrouter.ai/api/v1/models/meta-llama/llama-4-maverick/endpoints",
      },
      {
        model: "deepseek/deepseek-v4-pro",
        pinnedProvider: "deepseek",
        expectedChargeUsd: 0.000522,
        source: "https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-pro/endpoints",
      },
      {
        model: "deepseek/deepseek-v3.2",
        pinnedProvider: "deepinfra/fp4",
        expectedChargeUsd: 0.000298,
        source: "https://openrouter.ai/api/v1/models/deepseek/deepseek-v3.2/endpoints",
      },
      {
        model: "qwen/qwen3-235b-a22b-2507",
        pinnedProvider: "deepinfra/fp8",
        expectedChargeUsd: 0.0001,
        source: "https://openrouter.ai/api/v1/models/qwen/qwen3-235b-a22b-2507/endpoints",
      },
      {
        model: "mistralai/mistral-large-2512",
        pinnedProvider: "mistral",
        expectedChargeUsd: 0.00065,
        source: "https://openrouter.ai/api/v1/models/mistralai/mistral-large-2512/endpoints",
      },
      {
        model: "moonshotai/kimi-k2.7-code",
        pinnedProvider: "moonshotai/int4",
        expectedChargeUsd: 0.00135,
        source: "https://openrouter.ai/api/v1/models/moonshotai/kimi-k2.7-code/endpoints",
      },
      {
        model: "z-ai/glm-5.2",
        pinnedProvider: "z-ai/fp8",
        expectedChargeUsd: 0.00184,
        source: "https://openrouter.ai/api/v1/models/z-ai/glm-5.2/endpoints",
      },
    ];

    for (const row of rows) {
      expect(lookupPrice({
        provider: "openrouter",
        model: row.model,
        eventTime: "2026-07-06T00:00:00.000Z",
        plane: `${OPENROUTER_PLANE}:${row.pinnedProvider}`,
        usage: { input: 1_000, output: 100 },
      })).toMatchObject({
        ok: true,
        pricingStatus: "priced",
        expectedChargeUsd: row.expectedChargeUsd,
        source: row.source,
        sourceRetrievedAt: "2026-07-06",
      });
    }

    expect(lookupPrice({
      provider: "openrouter",
      model: "qwen/qwen3-235b-a22b-2507",
      eventTime: "2026-07-06T00:00:00.000Z",
      plane: `${OPENROUTER_PLANE}:deepinfra/fp8`,
      usage: { input: 1_000, output: 100, cache: { read: 100 } },
    })).toMatchObject({
      ok: true,
      pricingStatus: "partial",
    });
  });

  it("pricing-openrouter-unverified: keeps OpenRouter model pricing unknown without pinned endpoint evidence", () => {
    expect(lookupPrice({
      provider: "openrouter",
      model: "mistralai/mistral-large-2512",
      eventTime: "2026-07-06T00:00:00.000Z",
      usage: { input: 1_000, output: 100 },
    })).toEqual({
      ok: false,
      reason: "pricing_unknown",
      provider: "openrouter",
      model: "mistralai/mistral-large-2512",
      usageCategories: ["input", "output"],
    });

    const pinnedOnlyEvent = canonicalEvent({
      provider: "openrouter",
      model: "mistralai/mistral-large-2512",
      usage: { input: 1_000, output: 100 },
      request: {
        providerPlane: OPENROUTER_PLANE,
        generation: {
          openRouterPinnedUpstream: "mistral",
        },
      },
    });
    expect(estimateCostUsd(pinnedOnlyEvent)).toBe(0);

    const observedEndpointEvent = canonicalEvent({
      provider: "openrouter",
      model: "mistralai/mistral-large-2512",
      usage: { input: 1_000, output: 100 },
      request: {
        providerPlane: OPENROUTER_PLANE,
        generation: {
          openRouterPinnedUpstream: "mistral",
        },
      },
      response: {
        stopDetails: {
          openRouter: {
            selectedUpstreamProvider: "mistral",
            selectedUpstreamModel: "mistralai/mistral-large-2512",
            metadataStatus: "captured",
            metadataFieldPath: "$.openrouter_metadata.endpoints.available",
            endpointPrice: {
              prompt: "0.0000005",
              completion: "0.0000015",
              cache_read: "0.00000005",
            },
            endpointPriceSnapshot: {
              prompt: "0.0000005",
              completion: "0.0000015",
              cache_read: "0.00000005",
            },
          },
        },
      },
    });
    expect(estimateCostUsd(observedEndpointEvent)).toBe(0.00065);

    const mismatchedEndpointEvent = canonicalEvent({
      provider: "openrouter",
      model: "mistralai/mistral-large-2512",
      usage: { input: 1_000, output: 100 },
      response: {
        stopDetails: {
          openRouter: {
            selectedUpstreamProvider: "deepseek",
            selectedUpstreamModel: "deepseek/deepseek-v4-pro",
            metadataStatus: "captured",
            metadataFieldPath: "$.openrouter_metadata.endpoints.available",
            endpointPriceSnapshot: {
              prompt: "0.000000435",
              completion: "0.00000087",
              cache_read: "0.000000003625",
            },
          },
        },
      },
    });
    expect(lookupPriceForEvent(mismatchedEndpointEvent)).toEqual({
      ok: false,
      reason: "pricing_unknown",
      provider: "openrouter",
      model: "mistralai/mistral-large-2512",
      usageCategories: ["input", "output"],
    });

    const malformedEndpointEvent = canonicalEvent({
      provider: "openrouter",
      model: "mistralai/mistral-large-2512",
      usage: { input: 1_000, output: 100 },
      response: {
        stopDetails: {
          openRouter: {
            selectedUpstreamProvider: "mistral",
            selectedUpstreamModel: "mistralai/mistral-large-2512",
            metadataStatus: "captured",
            metadataFieldPath: "$.openrouter_metadata.endpoints.available",
            endpointPriceSnapshot: {},
          },
        },
      },
    });
    expect(lookupPriceForEvent(malformedEndpointEvent)).toEqual({
      ok: false,
      reason: "pricing_unknown",
      provider: "openrouter",
      model: "mistralai/mistral-large-2512",
      usageCategories: ["input", "output"],
    });
  });

  it("pricing-explicit-event-model: prices alternate model IDs with the same event usage", () => {
    const event = canonicalEvent({
      provider: "openai",
      model: "gpt-5.4",
      usage: {
        input: 1_000,
        output: 100,
      },
    });

    expect(lookupPriceForEventModel(event, "gpt-5.4")).toMatchObject({
      ok: true,
      expectedChargeUsd: 0.004,
    });
    expect(lookupPriceForEventModel(event, "gpt-5.4-mini")).toMatchObject({
      ok: true,
      expectedChargeUsd: 0.0012,
    });
  });

  it("pricing-completeness-routed-options: every static routed model option is fully priced", () => {
    const routedOptions = listStaticRoutedModelOptions();

    expect(routedOptions.length).toBeGreaterThan(0);
    for (const option of routedOptions) {
      const price = lookupPrice({
        provider: option.provider,
        model: option.model,
        plane: option.plane,
        eventTime: "2026-07-06T00:00:00.000Z",
        usage: { input: 1, output: 1 },
      });
      expect(price, `${option.provider}:${option.model}`).toMatchObject({
        ok: true,
        pricingStatus: "priced",
      });
    }
  });

  it("pricing-routed-options-cover-priced-compatible-registry: exposes every priced route-capable registry model", () => {
    const eventTime = "2026-07-06T00:00:00.000Z";
    const expected = new Set<string>();
    for (const entry of listModelPricingRegistryEntries()) {
      if (!entry.routeCompatibleModel || entry.routeCapabilities.length === 0) continue;
      const price = lookupPrice({
        provider: entry.provider,
        model: entry.routeCompatibleModel,
        plane: entry.plane,
        eventTime,
        usage: { input: 1, output: 1 },
      });
      if (price.ok && price.pricingStatus === "priced") {
        expected.add(`${entry.provider}:${entry.routeCompatibleModel}`);
      }
    }

    const exposed = new Set(listPricedModelOptions({ eventTime })
      .map((option) => `${option.provider}:${option.model}`));

    for (const model of expected) {
      expect(exposed.has(model), model).toBe(true);
    }
    expect(exposed.has("openai:gpt-5.5")).toBe(true);
    expect(exposed.has("anthropic:claude-opus-4-8")).toBe(true);
    expect(exposed.has("openrouter:mistralai/mistral-large-2512")).toBe(true);
  });

  it("pricing-provenance-default-registry: every default entry cites a provider URL and retrieval date", () => {
    const registryEntries = listModelPricingRegistryEntries();

    expect(registryEntries.length).toBeGreaterThan(0);
    for (const entry of registryEntries) {
      expect(entry.source, entry.model ?? entry.modelPattern).toMatch(/^https:\/\//);
      const retrievalDate = entry.provider === "openai" || entry.provider === "anthropic"
        ? "2026-07-05"
        : "2026-07-06";
      expect(entry.sourceRetrievedAt, entry.model ?? entry.modelPattern).toBe(retrievalDate);
    }
  });
});

function afterEachPricingReset(): void {
  afterEach(() => {
    clearModelPricing();
    registerDefaultModelPricing();
  });
}

function expectPartialUnpricedCategory(category: string): void {
  clearModelPricing();
  registerModelPricing({
    provider: "openai",
    model: "partial-category-model",
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 2,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: "2027-01-01T00:00:00.000Z",
    source: "test partial category model",
    pricingVersion: "test-registry",
  });

  const result = lookupPrice({
    provider: "openai",
    model: "partial-category-model",
    eventTime: "2026-06-14T12:00:00.000Z",
    usage: {
      input: 100,
      output: 0,
      categories: [{ category, tokens: 50 }],
    },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected partial price lookup to resolve");
  expect(result.pricingStatus).toBe("partial");
  expect(result.expectedChargeUsd).toBe(0.0001);
  expect(result.components).toHaveLength(2);
  expect(result.components[0]?.category).toBe("input");
  expect(result.components[0]?.chargeUsd).toBe(0.0001);

  const unpriced = result.components[1];
  expect(unpriced?.category).toBe(category);
  expect(unpriced?.quantity).toBe(50);
  expect(unpriced?.unit).toBe("tokens");
  expect(unpriced?.rateUsdPerMillion).toBe(null);
  expect(unpriced?.chargeUsd).toBe(null);
  expect(unpriced?.pricingStatus).toBe("unpriced");
}

function canonicalEvent(input: {
  readonly provider: CanonicalEventV1["request"]["provider"];
  readonly model: string;
  readonly usage: CanonicalEventV1["usage"] & Record<string, unknown>;
  readonly request?: Record<string, unknown>;
  readonly response?: Record<string, unknown>;
}): CanonicalEventV1 {
  return {
    request: {
      tenantId: "tenant-pricing",
      provider: input.provider,
      model: input.model,
      requestId: "req-pricing",
      expectCompletion: true,
      ...input.request,
    },
    response: {
      statusCode: 200,
      finishReason: "stop",
      content: "completed",
      ...input.response,
    },
    usage: input.usage,
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
}

function readJsonFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(
    new URL(`./__fixtures__/${name}`, import.meta.url),
    "utf8",
  )) as Record<string, unknown>;
}

function recordField(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = record[field];
  if (!isRecord(value)) throw new Error(`Expected fixture field ${field} to be an object.`);
  return value;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected fixture field ${field} to be a string.`);
  }
  return value;
}

function numberField(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected fixture field ${field} to be a finite number.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
