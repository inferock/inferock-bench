export declare const SECURITY_SECRET_PATTERN_VERSION: "security-governance:v0";
export declare const REQUEST_SECRET_DIGEST_CAPTURE_VERSION: "request_secret_digest_v1";
export declare const REQUEST_SECRET_DIGEST_ALGORITHM: "hmac-sha256";
export declare const REQUEST_SECRET_DIGEST_SCOPE: "event";
export declare const REQUEST_SECRET_DIGEST_MAX_PER_EVENT = 32;
export declare const REQUEST_SECRET_FIELD_PATH_MAX_LENGTH = 512;
export declare const REQUEST_SECRET_DIGEST_KEY_ID_PATTERN: RegExp;
export interface TextSurface {
    readonly text: string;
    readonly fieldPath: string;
}
export interface SecuritySecretMatch extends TextSurface {
    readonly category: string;
    readonly span: string;
    readonly matchLength: number;
    readonly patternVersion: typeof SECURITY_SECRET_PATTERN_VERSION;
}
export declare function findSecuritySecretMatches(surfaces: readonly TextSurface[]): SecuritySecretMatch[];
export declare function findSecuritySecretMatchesInValue(value: unknown, rootFieldPath: string): SecuritySecretMatch[];
export declare function requestSecretDigestPayload(input: {
    readonly tenantId: string;
    readonly requestId: string;
    readonly attemptIndex: number;
    readonly patternVersion: string;
    readonly category: string;
    readonly span: string;
}): string;
export declare function isRequestSecretDigestKeyId(value: string): boolean;
//# sourceMappingURL=security-secrets.d.ts.map