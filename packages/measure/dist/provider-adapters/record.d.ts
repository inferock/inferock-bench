export type JsonRecord = Record<string, unknown>;
export declare function isRecord(value: unknown): value is JsonRecord;
export declare function asRecord(value: unknown): JsonRecord | undefined;
export declare function stringValue(value: unknown): string | undefined;
export declare function numberValue(value: unknown): number | undefined;
export declare function booleanValue(value: unknown): boolean | undefined;
export declare function recordArray(value: unknown): JsonRecord[] | undefined;
export declare function parseJsonRecord(text: string): JsonRecord | undefined;
export declare function textFromContent(value: unknown): string;
export declare function compactRecord(input: JsonRecord): JsonRecord;
export declare function collectRateLimitHeaders(headers: Headers): Record<string, string>;
export declare function joinUrl(baseUrl: string, path: string): string;
//# sourceMappingURL=record.d.ts.map