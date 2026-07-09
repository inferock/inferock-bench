import { describe, expect, it } from "vitest";
import {
  normalizeCanonicalEvent,
  type CanonicalEventV2,
} from "./canonical-event.js";
import { detectToolCallValidity } from "./tool-call-validity.js";

describe("tool-call-validity detector", () => {
  it("tool-call-validity-openai-malformed-json: emits malformed tool-call evidence without exposing the full schema", () => {
    const event = normalizedEvent({
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
      },
    });

    const signals = detectToolCallValidity(event);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      code: "MALFORMED_TOOL_CALL",
      detector: "tool-call-validity",
      failureClass: "malformed_tool_call",
      domain: "loss",
      valueKind: "money",
      recoverableBasis: "whole_call",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      dispute: true,
    });
    expect(signals[0]?.evidence).toMatchObject({
      invalidCalls: [
        {
          provider: "openai",
          providerSurface: "chat_completions",
          providerPath: "response.rawToolCalls[0].function.arguments",
          toolName: "lookup_invoice",
          toolId: "call-1",
          schemaHash: "sha256:lookup-invoice",
          parser: { ok: false },
        },
      ],
    });
    expect(JSON.stringify(signals[0]?.evidence)).not.toContain("additionalProperties");
  });

  it("tool-call-validity-openai-schema-violation: validates parsed arguments against the captured request schema", () => {
    const event = normalizedEvent({
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"status\":\"paid\"}" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"status\":\"paid\"}" })],
      },
    });

    const signals = detectToolCallValidity(event);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      code: "TOOL_CALL_SCHEMA_VIOLATION",
      failureClass: "tool_call_schema_violation",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      recoverableBasis: "whole_call",
    });
    expect(signals[0]?.evidence).toMatchObject({
      invalidCalls: [
        {
          toolName: "lookup_invoice",
          schemaHash: "sha256:lookup-invoice",
          parser: { ok: true },
          validation: {
            ok: false,
            errors: expect.arrayContaining([
              expect.objectContaining({ keyword: "required" }),
            ]),
          },
        },
      ],
    });
  });

  it("tool-call-validity-openai-undeclared: treats unmatched names as triage-only undeclared tool calls", () => {
    const event = normalizedEvent({
      response: {
        toolCalls: [openAiToolCall({
          name: "delete_invoice",
          argumentsText: "{\"invoiceId\":\"inv-123\"}",
        })],
        rawToolCalls: [openAiToolCall({
          name: "delete_invoice",
          argumentsText: "{\"invoiceId\":\"inv-123\"}",
        })],
      },
    });

    const signals = detectToolCallValidity(event);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      code: "UNDECLARED_TOOL_CALL",
      failureClass: "undeclared_tool_call",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      dispute: false,
      liabilityParty: "unknown",
      recoverableBasis: "whole_call",
    });
  });

  it("tool-call-validity-openai-additional-property: reports additionalProperties violations", () => {
    const event = normalizedEvent({
      response: {
        toolCalls: [openAiToolCall({
          argumentsText: "{\"invoiceId\":\"inv-123\",\"extra\":\"ignored\"}",
        })],
        rawToolCalls: [openAiToolCall({
          argumentsText: "{\"invoiceId\":\"inv-123\",\"extra\":\"ignored\"}",
        })],
      },
    });

    const signals = detectToolCallValidity(event);

    expect(signals.map((signal) => signal.code)).toEqual(["TOOL_CALL_SCHEMA_VIOLATION"]);
    expect(signals[0]?.evidence).toMatchObject({
      invalidCalls: [
        {
          validation: {
            errors: expect.arrayContaining([
              expect.objectContaining({ keyword: "additionalProperties" }),
            ]),
          },
        },
      ],
    });
  });

  it("tool-call-validity-openai-responses-valid: accepts strict Responses function_call arguments", () => {
    const event = openAiResponsesEvent({
      toolCalls: [openAiResponsesToolCall({
        argumentsText: "{\"invoiceId\":\"inv-123\"}",
      })],
      rawToolCalls: [openAiResponsesToolCall({
        argumentsText: "{\"invoiceId\":\"inv-123\"}",
      })],
    });

    expect(detectToolCallValidity(event)).toEqual([]);
  });

  it("tool-call-validity-openai-responses-malformed-json: parses top-level Responses function_call arguments", () => {
    const event = openAiResponsesEvent({
      toolCalls: [openAiResponsesToolCall({ argumentsText: "{\"invoiceId\":" })],
      rawToolCalls: [openAiResponsesToolCall({ argumentsText: "{\"invoiceId\":" })],
    });

    const signals = detectToolCallValidity(event);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      code: "MALFORMED_TOOL_CALL",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      dispute: true,
      evidence: {
        invalidCalls: [
          {
            provider: "openai",
            providerSurface: "openai_responses",
            providerPath: "response.rawToolCalls[0].arguments",
            toolId: "call_1",
            toolName: "lookup_invoice",
            parser: { ok: false, reason: "invalid_json" },
            rawArgumentsExcerpt: "{\"invoiceId\":",
          },
        ],
      },
    });
  });

  it("tool-call-validity-openai-responses-schema-violation: validates Responses arguments against captured tool schema", () => {
    const event = openAiResponsesEvent({
      toolCalls: [openAiResponsesToolCall({ argumentsText: "{\"status\":\"paid\"}" })],
      rawToolCalls: [openAiResponsesToolCall({ argumentsText: "{\"status\":\"paid\"}" })],
    });

    const signals = detectToolCallValidity(event);

    expect(signals.map((signal) => signal.code)).toEqual(["TOOL_CALL_SCHEMA_VIOLATION"]);
    expect(signals[0]?.evidence).toMatchObject({
      invalidCalls: [
        {
          providerSurface: "openai_responses",
          providerPath: "response.rawToolCalls[0].arguments",
          toolName: "lookup_invoice",
          parser: { ok: true },
          validation: {
            ok: false,
            errors: expect.arrayContaining([
              expect.objectContaining({ keyword: "required" }),
            ]),
          },
        },
      ],
    });
  });

  it("tool-call-validity-openai-responses-undeclared-and-tool-choice: resolves Responses names against declarations", () => {
    const event = openAiResponsesEvent({
      request: {
        toolDeclarations: [
          toolDeclaration({
            providerSurface: "openai_responses",
            toolChoice: { type: "function", name: "lookup_invoice" },
          }),
        ],
      },
      toolCalls: [openAiResponsesToolCall({
        name: "delete_invoice",
        argumentsText: "{\"invoiceId\":\"inv-123\"}",
      })],
      rawToolCalls: [openAiResponsesToolCall({
        name: "delete_invoice",
        argumentsText: "{\"invoiceId\":\"inv-123\"}",
      })],
    });

    const signals = detectToolCallValidity(event);

    expect(signals.map((signal) => signal.code)).toEqual([
      "TOOL_CHOICE_VIOLATION",
      "UNDECLARED_TOOL_CALL",
    ]);
    expect(signals[0]?.evidence).toMatchObject({
      violations: [
        {
          reason: "named_tool_choice_not_satisfied",
          requiredToolName: "lookup_invoice",
          observedToolNames: ["delete_invoice"],
        },
      ],
    });
    expect(signals[1]?.evidence).toMatchObject({
      invalidCalls: [
        {
          provider: "openai",
          providerPath: "response.rawToolCalls[0].arguments",
          toolName: "delete_invoice",
          declaration: { matched: false },
        },
      ],
    });
  });

  it("tool-call-validity-openai-responses-refund-gate: keeps Responses candidates gated by raw strict complete billed evidence", () => {
    const candidate = openAiResponsesEvent({
      toolCalls: [openAiResponsesToolCall({ argumentsText: "{\"invoiceId\":" })],
      rawToolCalls: [openAiResponsesToolCall({ argumentsText: "{\"invoiceId\":" })],
    });
    const normalizedOnly = openAiResponsesEvent({
      toolCalls: [openAiResponsesToolCall({ argumentsText: "{\"invoiceId\":" })],
    });
    const aborted = openAiResponsesEvent({
      toolCalls: [openAiResponsesToolCall({ argumentsText: "{\"invoiceId\":" })],
      rawToolCalls: [openAiResponsesToolCall({ argumentsText: "{\"invoiceId\":" })],
      timing: { terminalStatus: "aborted" },
    });
    const nonStrict = openAiResponsesEvent({
      request: {
        toolDeclarations: [toolDeclaration({
          providerSurface: "openai_responses",
          strict: false,
        })],
      },
      toolCalls: [openAiResponsesToolCall({ argumentsText: "{\"invoiceId\":" })],
      rawToolCalls: [openAiResponsesToolCall({ argumentsText: "{\"invoiceId\":" })],
    });

    expect(detectToolCallValidity(candidate)[0]).toMatchObject({
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
    });
    for (const event of [normalizedOnly, aborted, nonStrict]) {
      expect(detectToolCallValidity(event)[0]).toMatchObject({
        code: "MALFORMED_TOOL_CALL",
        status: "triage_only",
        evidenceGrade: "triage_only",
        creditCandidate: false,
      });
    }
  });

  it("tool-call-validity-anthropic-input: validates Anthropic tool_use input objects", () => {
    const event = normalizedEvent({
      request: { provider: "anthropic", requestedModel: "claude-haiku-4-5-20251001", model: "claude-haiku-4-5-20251001" },
      response: {
        servedModel: "claude-haiku-4-5-20251001",
        finishReason: "tool_use",
        toolCalls: [{
          type: "tool_use",
          id: "toolu-1",
          name: "lookup_invoice",
          input: { status: "paid" },
        }],
        rawToolCalls: [{
          type: "tool_use",
          id: "toolu-1",
          name: "lookup_invoice",
          input: { status: "paid" },
        }],
      },
      providerSurface: "anthropic_messages",
    });

    const signals = detectToolCallValidity(event);

    expect(signals.map((signal) => signal.code)).toEqual(["TOOL_CALL_SCHEMA_VIOLATION"]);
    expect(signals[0]?.evidence).toMatchObject({
      invalidCalls: [
        {
          provider: "anthropic",
          providerSurface: "anthropic_messages",
          providerPath: "response.rawToolCalls[0].input",
          toolId: "toolu-1",
          toolName: "lookup_invoice",
        },
      ],
    });
  });

  it("tool-call-validity-gemini-function-call: validates Gemini functionCall args against captured schemas", () => {
    const geminiCall = {
      type: "function_call",
      provider: "gemini",
      name: "lookup_invoice",
      functionCall: {
        id: "gemini-call-1",
        name: "lookup_invoice",
        args: { invoiceId: 123 },
      },
      args: { invoiceId: 123 },
    };
    const event = normalizedEvent({
      request: {
        provider: "gemini",
        requestedModel: "gemini-2.5-flash",
        model: "gemini-2.5-flash",
      },
      response: {
        servedModel: "gemini-2.5-flash-001",
        finishReason: "stop",
        toolCalls: [geminiCall],
        rawToolCalls: [geminiCall],
      },
      providerSurface: "gemini_generate_content",
    });

    const signals = detectToolCallValidity(event);

    expect(signals.map((signal) => signal.code)).toEqual(["TOOL_CALL_SCHEMA_VIOLATION"]);
    expect(signals[0]?.evidence).toMatchObject({
      invalidCalls: [
        {
          provider: "gemini",
          providerSurface: "gemini_generate_content",
          providerPath: "response.rawToolCalls[0].functionCall.args",
          toolName: "lookup_invoice",
          toolId: "gemini-call-1",
          rawInputExcerpt: "{\"invoiceId\":123}",
          parser: { ok: true },
          validation: {
            ok: false,
            errors: expect.arrayContaining([
              expect.objectContaining({ keyword: "type" }),
            ]),
          },
        },
      ],
    });
  });

  it("tool-call-validity-gemini-finish-reason: preserves Gemini terminal tool-validity evidence", () => {
    const event = normalizedEvent({
      request: {
        provider: "gemini",
        requestedModel: "gemini-2.5-flash",
        model: "gemini-2.5-flash",
      },
      response: {
        servedModel: "gemini-2.5-flash-001",
        finishReason: "malformed_function_call",
        stopDetails: {
          candidates: [
            {
              candidateIndex: 0,
              finishReason: "MALFORMED_FUNCTION_CALL",
              toolValidityEvidence: true,
            },
          ],
        },
      },
      providerSurface: "gemini_generate_content",
    });

    const signals = detectToolCallValidity(event);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      code: "MALFORMED_TOOL_CALL",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      evidence: {
        invalidCalls: [
          {
            provider: "gemini",
            reason: "gemini_tool_validity_finish_reason",
            finishReason: "malformed_function_call",
            stopDetails: {
              candidates: [
                {
                  candidateIndex: 0,
                  finishReason: "MALFORMED_FUNCTION_CALL",
                  toolValidityEvidence: true,
                },
              ],
            },
          },
        ],
      },
    });
  });

  it("tool-call-validity-anthropic-streaming-malformed: preserves assembled malformed input_json_delta evidence", () => {
    const event = normalizedEvent({
      request: { provider: "anthropic", requestedModel: "claude-haiku-4-5-20251001", model: "claude-haiku-4-5-20251001" },
      response: {
        servedModel: "claude-haiku-4-5-20251001",
        finishReason: "tool_use",
        toolCalls: [{
          type: "tool_use",
          id: "toolu-1",
          name: "lookup_invoice",
          index: 0,
          inputJson: "{\"invoiceId\":",
          inputJsonPartials: ["{\"invoice", "Id\":"],
          inputParseResult: { ok: false, reason: "invalid_json" },
        }],
        rawToolCalls: [{
          type: "tool_use",
          id: "toolu-1",
          name: "lookup_invoice",
          index: 0,
          inputJson: "{\"invoiceId\":",
          inputJsonPartials: ["{\"invoice", "Id\":"],
          inputParseResult: { ok: false, reason: "invalid_json" },
        }],
      },
      providerSurface: "anthropic_messages",
    });

    const signals = detectToolCallValidity(event);

    expect(signals.map((signal) => signal.code)).toEqual(["MALFORMED_TOOL_CALL"]);
    expect(signals[0]?.evidence).toMatchObject({
      invalidCalls: [
        {
          rawInputExcerpt: "{\"invoiceId\":",
          parser: { ok: false },
        },
      ],
    });
  });

  it("tool-call-validity-valid-calls: returns no signal for valid OpenAI and Anthropic calls", () => {
    const openAi = normalizedEvent({
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":\"inv-123\"}" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":\"inv-123\"}" })],
      },
    });
    const anthropic = normalizedEvent({
      request: { provider: "anthropic", requestedModel: "claude-haiku-4-5-20251001", model: "claude-haiku-4-5-20251001" },
      response: {
        servedModel: "claude-haiku-4-5-20251001",
        finishReason: "tool_use",
        toolCalls: [{
          type: "tool_use",
          id: "toolu-1",
          name: "lookup_invoice",
          input: { invoiceId: "inv-123" },
        }],
        rawToolCalls: [{
          type: "tool_use",
          id: "toolu-1",
          name: "lookup_invoice",
          input: { invoiceId: "inv-123" },
        }],
      },
      providerSurface: "anthropic_messages",
    });

    expect(detectToolCallValidity(openAi)).toEqual([]);
    expect(detectToolCallValidity(anthropic)).toEqual([]);
  });

  it("tool-call-validity-parser-branch-chat-and-anthropic-unchanged: keeps non-Responses parse paths pinned", () => {
    const chat = normalizedEvent({
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
      },
    });
    const anthropic = normalizedEvent({
      request: { provider: "anthropic", requestedModel: "claude-haiku-4-5-20251001", model: "claude-haiku-4-5-20251001" },
      response: {
        servedModel: "claude-haiku-4-5-20251001",
        finishReason: "tool_use",
        toolCalls: [{
          type: "tool_use",
          id: "toolu-1",
          name: "lookup_invoice",
          inputJson: "{\"invoiceId\":",
        }],
        rawToolCalls: [{
          type: "tool_use",
          id: "toolu-1",
          name: "lookup_invoice",
          inputJson: "{\"invoiceId\":",
        }],
      },
      providerSurface: "anthropic_messages",
    });

    expect(detectToolCallValidity(chat)[0]?.evidence).toMatchObject({
      invalidCalls: [
        {
          provider: "openai",
          providerSurface: "chat_completions",
          providerPath: "response.rawToolCalls[0].function.arguments",
          toolId: "call-1",
          toolName: "lookup_invoice",
        },
      ],
    });
    expect(detectToolCallValidity(anthropic)[0]?.evidence).toMatchObject({
      invalidCalls: [
        {
          provider: "anthropic",
          providerSurface: "anthropic_messages",
          providerPath: "response.rawToolCalls[0].inputJson",
          toolId: "toolu-1",
          toolName: "lookup_invoice",
        },
      ],
    });
  });

  it("tool-call-validity-missing-schema-triage: keeps detectable malformed calls out of refundable dollars without schema capture", () => {
    const event = normalizedEvent({
      request: { toolDeclarations: undefined },
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
      },
    });

    const signals = detectToolCallValidity(event);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      code: "MALFORMED_TOOL_CALL",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      providerRecoverableLossUsd: null,
    });
  });

  it("tool-call-validity-aggregate-per-code: preserves every invalid call for a repeated code", () => {
    const event = normalizedEvent({
      response: {
        toolCalls: [
          openAiToolCall({ id: "call-1", argumentsText: "{\"invoiceId\":" }),
          openAiToolCall({ id: "call-2", argumentsText: "{\"invoiceId\":" }),
        ],
        rawToolCalls: [
          openAiToolCall({ id: "call-1", argumentsText: "{\"invoiceId\":" }),
          openAiToolCall({ id: "call-2", argumentsText: "{\"invoiceId\":" }),
        ],
      },
    });

    const signals = detectToolCallValidity(event);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.code).toBe("MALFORMED_TOOL_CALL");
    expect((signals[0]?.evidence.invalidCalls as readonly unknown[] | undefined)?.length).toBe(2);
  });

  it("tool-call-validity-pricing-unknown-stays-whole-call-candidate: keeps complete evidence in the attribution pool", () => {
    const event = normalizedEvent({
      request: { model: "unknown-model", requestedModel: "unknown-model" },
      response: {
        servedModel: "unknown-model",
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
      },
    });

    const signals = detectToolCallValidity(event);

    expect(signals[0]).toMatchObject({
      code: "MALFORMED_TOOL_CALL",
      status: "pricing_unknown",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      pricingStatus: "pricing_unknown",
      providerRecoverableLossUsd: null,
      recoverableBasis: "whole_call",
    });
  });

  it("refundable-requires-raw: keeps normalized-only malformed calls triage-only", () => {
    const normalizedOnly = normalizedEvent({
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
      },
    });
    const rawBacked = normalizedEvent({
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
      },
    });

    expect(detectToolCallValidity(normalizedOnly)[0]).toMatchObject({
      code: "MALFORMED_TOOL_CALL",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
      dispute: false,
    });
    expect(detectToolCallValidity(rawBacked)[0]).toMatchObject({
      code: "MALFORMED_TOOL_CALL",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
      dispute: true,
    });
  });

  it("refundable-requires-captured-schema: keeps schema-absent declarations triage-only", () => {
    const schemaAbsent = normalizedEvent({
      request: {
        toolDeclarations: [{
          providerSurface: "chat_completions",
          name: "lookup_invoice",
          schemaHash: "schema_absent",
          strict: true,
        }],
      },
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
      },
    });
    const schemaCaptured = normalizedEvent({
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
      },
    });

    expect(detectToolCallValidity(schemaAbsent)[0]).toMatchObject({
      code: "MALFORMED_TOOL_CALL",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
    });
    expect(detectToolCallValidity(schemaCaptured)[0]).toMatchObject({
      code: "MALFORMED_TOOL_CALL",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
    });
  });

  it("refundable-requires-terminal-marker: keeps ambiguous stream aborts triage-only", () => {
    const aborted = normalizedEvent({
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
      },
      timing: { terminalStatus: "aborted" },
    });
    const complete = normalizedEvent({
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
      },
      timing: { terminalStatus: "complete" },
    });

    expect(detectToolCallValidity(aborted)[0]).toMatchObject({
      code: "MALFORMED_TOOL_CALL",
      status: "triage_only",
      evidenceGrade: "triage_only",
      creditCandidate: false,
    });
    expect(detectToolCallValidity(complete)[0]).toMatchObject({
      code: "MALFORMED_TOOL_CALL",
      status: "candidate",
      evidenceGrade: "refundable_candidate",
      creditCandidate: true,
    });
  });

  it("refundable-requires-strict-true: keeps non-strict invalid tool args triage-only", () => {
    const strictFalse = normalizedEvent({
      request: {
        toolDeclarations: [toolDeclaration({ strict: false })],
      },
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"status\":\"paid\"}" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"status\":\"paid\"}" })],
      },
    });
    const strictAbsent = normalizedEvent({
      request: {
        toolDeclarations: [toolDeclaration({ strict: undefined })],
      },
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"status\":\"paid\"}" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"status\":\"paid\"}" })],
      },
    });

    for (const event of [strictFalse, strictAbsent]) {
      expect(detectToolCallValidity(event)[0]).toMatchObject({
        code: "TOOL_CALL_SCHEMA_VIOLATION",
        status: "triage_only",
        evidenceGrade: "triage_only",
        creditCandidate: false,
        dispute: false,
      });
    }
    expect(detectToolCallValidity(strictFalse)[0]?.evidence).toMatchObject({
      invalidCalls: [
        {
          strict: false,
          strictApplicability: {
            applies: false,
            blockers: ["strict_false"],
          },
        },
      ],
    });
    expect(detectToolCallValidity(strictAbsent)[0]?.evidence).toMatchObject({
      invalidCalls: [
        {
          strictApplicability: {
            applies: false,
            blockers: ["strict_not_captured_true"],
          },
        },
      ],
    });
  });

  it("refundable-excludes-strict-guarantee-exceptions: records invalid strict tool calls as triage when provider docs void the guarantee", () => {
    const length = normalizedEvent({
      response: {
        finishReason: "length",
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
      },
    });
    const refusal = normalizedEvent({
      response: {
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        providerSafety: [{ kind: "refusal", source: "provider", reason: "policy" }],
      },
    });
    const eagerAnthropic = normalizedEvent({
      request: {
        provider: "anthropic",
        requestedModel: "claude-haiku-4-5-20251001",
        model: "claude-haiku-4-5-20251001",
        generation: { eagerInputStreaming: true },
        toolDeclarations: [toolDeclaration({ providerSurface: "anthropic_messages" })],
      },
      response: {
        servedModel: "claude-haiku-4-5-20251001",
        finishReason: "tool_use",
        toolCalls: [{
          type: "tool_use",
          id: "toolu-1",
          name: "lookup_invoice",
          inputJson: "{\"invoiceId\":",
        }],
        rawToolCalls: [{
          type: "tool_use",
          id: "toolu-1",
          name: "lookup_invoice",
          inputJson: "{\"invoiceId\":",
        }],
      },
    });
    const fineTunedParallel = normalizedEvent({
      request: {
        requestedModel: "ft:gpt-4o-mini:org:invoice:id",
        model: "ft:gpt-4o-mini:org:invoice:id",
        toolDeclarations: [toolDeclaration({ parallelToolCalls: true })],
      },
      response: {
        servedModel: "ft:gpt-4o-mini:org:invoice:id",
        toolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
        rawToolCalls: [openAiToolCall({ argumentsText: "{\"invoiceId\":" })],
      },
    });
    const maxTokensAnthropic = normalizedEvent({
      request: {
        provider: "anthropic",
        requestedModel: "claude-haiku-4-5-20251001",
        model: "claude-haiku-4-5-20251001",
        toolDeclarations: [toolDeclaration({ providerSurface: "anthropic_messages" })],
      },
      response: {
        servedModel: "claude-haiku-4-5-20251001",
        finishReason: "max_tokens",
        toolCalls: [{
          type: "tool_use",
          id: "toolu-1",
          name: "lookup_invoice",
          inputJson: "{\"invoiceId\":",
        }],
        rawToolCalls: [{
          type: "tool_use",
          id: "toolu-1",
          name: "lookup_invoice",
          inputJson: "{\"invoiceId\":",
        }],
      },
    });

    const cases = [
      [length, "max_output_tokens"],
      [refusal, "provider_refusal"],
      [eagerAnthropic, "anthropic_eager_input_streaming"],
      [fineTunedParallel, "openai_fine_tuned_parallel_tool_calls_disable_strict"],
      [maxTokensAnthropic, "max_output_tokens"],
    ] as const;

    for (const [event, blocker] of cases) {
      const signal = detectToolCallValidity(event)[0];
      expect(signal).toMatchObject({
        status: "triage_only",
        evidenceGrade: "triage_only",
        creditCandidate: false,
        dispute: false,
      });
      expect(JSON.stringify(signal?.evidence)).toContain(blocker);
    }
  });

  it("tool-choice-violation-required-or-named-triage: emits triage-only when forced tool_choice is not satisfied", () => {
    const requiredNoTool = normalizedEvent({
      request: {
        toolDeclarations: [toolDeclaration({ toolChoice: "required" })],
      },
      response: {
        finishReason: "stop",
        toolCalls: undefined,
        rawToolCalls: undefined,
      },
    });
    const namedWrongTool = normalizedEvent({
      request: {
        toolDeclarations: [
          toolDeclaration({
            toolChoice: { type: "function", function: { name: "lookup_invoice" } },
          }),
        ],
      },
      response: {
        finishReason: "tool_calls",
        toolCalls: [openAiToolCall({
          name: "lookup_customer",
          argumentsText: "{\"invoiceId\":\"inv-123\"}",
        })],
        rawToolCalls: [openAiToolCall({
          name: "lookup_customer",
          argumentsText: "{\"invoiceId\":\"inv-123\"}",
        })],
      },
    });

    expect(detectToolCallValidity(requiredNoTool)).toEqual([
      expect.objectContaining({
        code: "TOOL_CHOICE_VIOLATION",
        status: "triage_only",
        evidenceGrade: "triage_only",
        creditCandidate: false,
        recoverableBasis: "whole_call",
        evidence: expect.objectContaining({
          reason: "tool_choice_violation",
          violations: [
            expect.objectContaining({
              reason: "required_tool_choice_not_satisfied",
              toolChoice: "required",
              toolBlockCount: 0,
            }),
          ],
        }),
      }),
    ]);
    expect(detectToolCallValidity(namedWrongTool).map((signal) => signal.code)).toContain(
      "TOOL_CHOICE_VIOLATION",
    );
    expect(detectToolCallValidity(namedWrongTool)[0]?.evidence).toMatchObject({
      violations: [
        {
          reason: "named_tool_choice_not_satisfied",
          requiredToolName: "lookup_invoice",
          observedToolNames: ["lookup_customer"],
        },
      ],
    });
  });

  it("tool-stop-reason-without-tool-blocks: emits triage-only when terminal tool stop reason has no tool calls", () => {
    const event = normalizedEvent({
      response: {
        finishReason: "tool_calls",
        toolCalls: undefined,
        rawToolCalls: undefined,
      },
    });

    expect(detectToolCallValidity(event)).toEqual([
      expect.objectContaining({
        code: "TOOL_CALL_STOP_REASON_MISMATCH",
        status: "triage_only",
        evidenceGrade: "triage_only",
        creditCandidate: false,
        evidence: expect.objectContaining({
          reason: "tool_stop_reason_without_tool_block",
          violations: [
            expect.objectContaining({
              finishReason: "tool_calls",
              toolBlockCount: 0,
            }),
          ],
        }),
      }),
    ]);
  });
});

function normalizedEvent(input: {
  readonly request?: Partial<CanonicalEventV2["request"]>;
  readonly response?: Partial<CanonicalEventV2["response"]>;
  readonly timing?: Partial<CanonicalEventV2["timing"]>;
  readonly providerSurface?: string;
} = {}) {
  return normalizeCanonicalEvent({
    schemaVersion: "v2",
    request: {
      tenantId: "tenant-tool-call",
      provider: "openai",
      requestId: "req-tool-call",
      requestedModel: "gpt-4o-mini",
      model: "gpt-4o-mini",
      attemptIndex: 0,
      expectCompletion: true,
      route: "chat.completions",
      toolDeclarations: input.request?.toolDeclarations ?? [
        toolDeclaration({ providerSurface: input.providerSurface ?? "chat_completions" }),
      ],
      ...input.request,
    },
    response: {
      statusCode: 200,
      finishReason: "tool_calls",
      content: "",
      servedModel: "gpt-4o-mini",
      ...input.response,
    },
    usage: {
      input: 100,
      output: 10,
      cache: { read: 0, creation: 0 },
      categories: [
        { category: "prompt", tokens: 100 },
        { category: "completion", tokens: 10 },
      ],
      usageSource: "provider",
    },
    timing: {
      startedAt: "2026-06-14T12:00:00.000Z",
      endedAt: "2026-06-14T12:00:01.000Z",
      latencyMs: 1_000,
      chunkCount: 1,
      terminalStatus: "complete",
      ...input.timing,
    },
    attempts: [
      {
        attemptNumber: 0,
        provider: input.request?.provider ?? "openai",
        model: input.request?.model ?? "gpt-4o-mini",
        status: "success",
        timing: {
          startedAt: "2026-06-14T12:00:00.000Z",
          endedAt: "2026-06-14T12:00:01.000Z",
          latencyMs: 1_000,
        },
        finalSelected: true,
      },
    ],
  } satisfies CanonicalEventV2);
}

function openAiResponsesEvent(input: {
  readonly request?: Partial<CanonicalEventV2["request"]>;
  readonly toolCalls?: readonly Record<string, unknown>[];
  readonly rawToolCalls?: readonly Record<string, unknown>[];
  readonly timing?: Partial<CanonicalEventV2["timing"]>;
}) {
  return normalizedEvent({
    request: {
      requestedModel: "gpt-4o-mini",
      model: "gpt-4o-mini",
      route: "openai.responses",
      toolDeclarations: input.request?.toolDeclarations ?? [
        toolDeclaration({ providerSurface: "openai_responses" }),
      ],
      ...input.request,
    },
    response: {
      finishReason: "completed",
      servedModel: "gpt-4o-mini",
      toolCalls: input.toolCalls,
      rawToolCalls: input.rawToolCalls,
    },
    timing: input.timing,
  });
}

function toolDeclaration(
  overrides: Partial<NonNullable<CanonicalEventV2["request"]["toolDeclarations"]>[number]> = {},
): NonNullable<CanonicalEventV2["request"]["toolDeclarations"]>[number] {
  const declaration: NonNullable<CanonicalEventV2["request"]["toolDeclarations"]>[number] = {
    providerSurface: "chat_completions",
    name: "lookup_invoice",
    schemaHash: "sha256:lookup-invoice",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["invoiceId"],
      properties: {
        invoiceId: { type: "string" },
      },
    },
    strict: true,
    toolChoice: "auto",
    parallelToolCalls: false,
    ...overrides,
  };
  if (overrides.strict === undefined && Object.prototype.hasOwnProperty.call(overrides, "strict")) {
    delete declaration.strict;
  }
  return declaration;
}

function openAiToolCall(input: {
  readonly id?: string;
  readonly name?: string;
  readonly argumentsText: string;
}): Record<string, unknown> {
  return {
    id: input.id ?? "call-1",
    index: 0,
    type: "function",
    function: {
      name: input.name ?? "lookup_invoice",
      arguments: input.argumentsText,
    },
  };
}

function openAiResponsesToolCall(input: {
  readonly id?: string;
  readonly callId?: string;
  readonly name?: string;
  readonly argumentsText: string;
}): Record<string, unknown> {
  return {
    id: input.id ?? "fc_1",
    index: 0,
    type: "function_call",
    call_id: input.callId ?? "call_1",
    name: input.name ?? "lookup_invoice",
    arguments: input.argumentsText,
    argumentsParseResult: input.argumentsText.endsWith(":")
      ? { ok: false, reason: "invalid_json" }
      : { ok: true },
  };
}
