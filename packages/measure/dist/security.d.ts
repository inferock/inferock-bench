import type { CanonicalEventV1 } from "./canonical-event.js";
export declare const SECURITY_SIGNAL_CODES: readonly ["SECURITY_SECRET_EXACT_MATCH", "SECURITY_PROVIDER_SAFETY_FIELD"];
export type SecuritySignalCode = (typeof SECURITY_SIGNAL_CODES)[number];
export type SecurityEvidenceGrade = "triage_only";
export type SecuritySignalStatus = "triage_only";
export interface SecuritySignal {
    readonly code: SecuritySignalCode;
    readonly detectorName: typeof DETECTOR_NAME;
    readonly detectorVersion: typeof DETECTOR_VERSION;
    readonly tenantId: string;
    readonly requestId: string;
    readonly provider: CanonicalEventV1["request"]["provider"];
    readonly model: string;
    readonly status: SecuritySignalStatus;
    readonly evidenceGrade: SecurityEvidenceGrade;
    readonly dispute: false;
    readonly liabilityParty: "unknown";
    readonly creditCandidate: false;
    readonly fieldPath: string;
    readonly category: string;
    readonly spanHash: string;
    readonly evidence: Record<string, unknown>;
    readonly valueJson: Record<string, unknown>;
}
export interface RequestSecretDigestKey {
    readonly keyId: string;
    readonly key: string;
}
export interface SecurityDetectorOptions {
    readonly requestSecretDigestKeys?: readonly RequestSecretDigestKey[];
}
declare const DETECTOR_NAME = "security-governance";
declare const DETECTOR_VERSION = "v0";
/**
 * Runs v0 security/governance detectors over output-only canonical fields.
 */
export declare function runSecurityDetectors(event: CanonicalEventV1, options?: SecurityDetectorOptions): SecuritySignal[];
export declare function spanHashForSecurityFinding(span: string): string;
export {};
//# sourceMappingURL=security.d.ts.map