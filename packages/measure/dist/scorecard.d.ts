export declare const SCORECARD_SIGNAL_ROW_KEYS_BY_CODE: {
    readonly BROKEN_OUTPUT: "broken_output";
    readonly TRUNCATED: "truncation";
    readonly BILLED_EMPTY: "billed_empty";
    readonly LATENCY_BILLED: "provider_latency_slo";
    readonly PROVIDER_DOWNTIME: "provider_downtime";
    readonly DUPLICATE_REQUEST_ID: "duplicate_request_id";
    readonly CACHE_RATE_ANOMALY: "cache_pricing_anomaly";
    readonly CACHE_DISCOUNT_AT_RISK: "cache_pricing_anomaly";
    readonly OPENAI_TOKEN_RECOUNT_MISMATCH: "openai_token_recount";
    readonly ANTHROPIC_TOKEN_CROSSCHECK: "anthropic_token_crosscheck";
    readonly REFUSAL_BILLED: "provider_refusal";
    readonly REFUSAL_PREOUTPUT_BILLED_INVARIANT: "provider_refusal";
    readonly PRICING_UNKNOWN: "pricing_unknown";
    readonly MALFORMED_TOOL_CALL: "tool_call_validity";
    readonly TOOL_CALL_SCHEMA_VIOLATION: "tool_call_validity";
    readonly UNDECLARED_TOOL_CALL: "tool_call_validity";
    readonly TOOL_CHOICE_VIOLATION: "tool_call_validity";
    readonly TOOL_CALL_STOP_REASON_MISMATCH: "tool_call_validity";
    readonly SERVED_MODEL_MISMATCH: "served_model_mismatch";
    readonly SECURITY_SECRET_EXACT_MATCH: "security_governance";
    readonly SECURITY_PROVIDER_SAFETY_FIELD: "security_governance";
    readonly FACTUALITY_KNOWN_ANSWER_FAIL: "factuality";
    readonly ANTHROPIC_CITATION_CONTRADICTS_CITED_TEXT: "factuality";
};
export type ScorecardSignalCode = keyof typeof SCORECARD_SIGNAL_ROW_KEYS_BY_CODE;
export type ScorecardSignalRowKey = (typeof SCORECARD_SIGNAL_ROW_KEYS_BY_CODE)[ScorecardSignalCode];
//# sourceMappingURL=scorecard.d.ts.map