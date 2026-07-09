export const SCORECARD_SIGNAL_ROW_KEYS_BY_CODE = {
  BROKEN_OUTPUT: "broken_output",
  TRUNCATED: "truncation",
  BILLED_EMPTY: "billed_empty",
  LATENCY_BILLED: "provider_latency_slo",
  PROVIDER_DOWNTIME: "provider_downtime",
  DUPLICATE_REQUEST_ID: "duplicate_request_id",
  CACHE_RATE_ANOMALY: "cache_pricing_anomaly",
  CACHE_DISCOUNT_AT_RISK: "cache_pricing_anomaly",
  OPENAI_TOKEN_RECOUNT_MISMATCH: "openai_token_recount",
  ANTHROPIC_TOKEN_CROSSCHECK: "anthropic_token_crosscheck",
  REFUSAL_BILLED: "provider_refusal",
  REFUSAL_PREOUTPUT_BILLED_INVARIANT: "provider_refusal",
  PRICING_UNKNOWN: "pricing_unknown",
  MALFORMED_TOOL_CALL: "tool_call_validity",
  TOOL_CALL_SCHEMA_VIOLATION: "tool_call_validity",
  UNDECLARED_TOOL_CALL: "tool_call_validity",
  TOOL_CHOICE_VIOLATION: "tool_call_validity",
  TOOL_CALL_STOP_REASON_MISMATCH: "tool_call_validity",
  SERVED_MODEL_MISMATCH: "served_model_mismatch",
  SECURITY_SECRET_EXACT_MATCH: "security_governance",
  SECURITY_PROVIDER_SAFETY_FIELD: "security_governance",
  FACTUALITY_KNOWN_ANSWER_FAIL: "factuality",
  ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT: "factuality",
} as const;

export type ScorecardSignalCode = keyof typeof SCORECARD_SIGNAL_ROW_KEYS_BY_CODE;
export type ScorecardSignalRowKey =
  (typeof SCORECARD_SIGNAL_ROW_KEYS_BY_CODE)[ScorecardSignalCode];
