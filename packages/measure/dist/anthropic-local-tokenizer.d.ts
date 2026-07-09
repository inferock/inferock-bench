export declare const CLAUDE_TOKENIZER_ESTIMATOR = "Xenova/claude-tokenizer";
export declare const CLAUDE_TOKENIZER_REVISION = "cae688821ea05490de49a6d3faa36468a4672fad";
export declare const CLAUDE_TOKENIZER_SOURCE_URL = "https://huggingface.co/Xenova/claude-tokenizer";
export declare const CLAUDE_TOKENIZER_LICENSE = "MIT";
export interface AnthropicOfflineTokenEstimate {
    readonly tokens: number;
    readonly estimator: typeof CLAUDE_TOKENIZER_ESTIMATOR;
    readonly revision: typeof CLAUDE_TOKENIZER_REVISION;
    readonly sourceUrl: typeof CLAUDE_TOKENIZER_SOURCE_URL;
    readonly license: typeof CLAUDE_TOKENIZER_LICENSE;
    readonly approximate: true;
}
export declare function estimateAnthropicOfflineOutputTokens(content: string): AnthropicOfflineTokenEstimate;
//# sourceMappingURL=anthropic-local-tokenizer.d.ts.map