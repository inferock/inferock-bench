import type { CanonicalEventV1 } from "./canonical-event.js";
import type { LossSignal } from "./types.js";
type ToolCallSignalCode = "MALFORMED_TOOL_CALL" | "TOOL_CALL_SCHEMA_VIOLATION" | "UNDECLARED_TOOL_CALL" | "TOOL_CHOICE_VIOLATION" | "TOOL_CALL_STOP_REASON_MISMATCH";
export declare function detectToolCallValidity(event: CanonicalEventV1): LossSignal[];
export type { ToolCallSignalCode };
//# sourceMappingURL=tool-call-validity.d.ts.map