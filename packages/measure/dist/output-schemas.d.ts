import { type ErrorObject, type Schema, type ValidateFunction } from "ajv";
export interface RegisterOutputSchemaInput {
    readonly tenantId: string;
    readonly schemaVersion: string;
    readonly schema: Schema;
}
export interface OutputSchemaValidationError {
    readonly instancePath: string;
    readonly keyword: string;
    readonly message: string;
    readonly schemaPath: string;
}
export declare function registerOutputSchema(input: RegisterOutputSchemaInput): void;
export declare function unregisterOutputSchema(tenantId: string, schemaVersion: string): void;
export declare function clearOutputSchemas(): void;
export declare function hasOutputSchema(tenantId: string, schemaVersion: string): boolean;
export declare function getOutputSchema(tenantId: string, schemaVersion: string): Schema | null;
export declare function getOutputValidator(tenantId: string, schemaVersion: string): ValidateFunction | null;
export declare function getJsonSchemaValidator(schemaKey: string, schema: Schema): ValidateFunction;
export declare function outputSchemaCacheSize(): number;
export declare function simplifyAjvErrors(errors: readonly ErrorObject[] | null | undefined): OutputSchemaValidationError[];
//# sourceMappingURL=output-schemas.d.ts.map