import type { CanonicalEventV1 } from "../canonical-event.js";
export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};
export declare function buildCanonicalEvent(overrides?: DeepPartial<CanonicalEventV1>): CanonicalEventV1;
//# sourceMappingURL=canonical-event-factory.d.ts.map