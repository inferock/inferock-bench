export interface SseMessage {
    readonly event?: string;
    readonly data: string;
}
export declare class SseAccumulator {
    #private;
    push(chunk: string): SseMessage[];
    end(): SseMessage[];
}
//# sourceMappingURL=sse.d.ts.map