import {
  Ajv,
  type ErrorObject,
  type Schema,
  type ValidateFunction,
} from "ajv";

const ajv = new Ajv({ allErrors: true, strict: false });
const registeredSchemas = new Map<string, Schema>();
const compiledSchemas = new Map<string, ValidateFunction>();
const compiledSchemaByKey = new Map<string, ValidateFunction>();

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

function schemaKey(tenantId: string, schemaVersion: string): string {
  return `${tenantId}:${schemaVersion}`;
}

export function registerOutputSchema(input: RegisterOutputSchemaInput): void {
  const key = schemaKey(input.tenantId, input.schemaVersion);
  registeredSchemas.set(key, input.schema);
  compiledSchemas.delete(key);
}

export function unregisterOutputSchema(tenantId: string, schemaVersion: string): void {
  const key = schemaKey(tenantId, schemaVersion);
  registeredSchemas.delete(key);
  compiledSchemas.delete(key);
}

export function clearOutputSchemas(): void {
  registeredSchemas.clear();
  compiledSchemas.clear();
  compiledSchemaByKey.clear();
}

export function hasOutputSchema(tenantId: string, schemaVersion: string): boolean {
  return registeredSchemas.has(schemaKey(tenantId, schemaVersion));
}

export function getOutputSchema(
  tenantId: string,
  schemaVersion: string,
): Schema | null {
  return registeredSchemas.get(schemaKey(tenantId, schemaVersion)) ?? null;
}

export function getOutputValidator(
  tenantId: string,
  schemaVersion: string,
): ValidateFunction | null {
  const key = schemaKey(tenantId, schemaVersion);
  const cached = compiledSchemas.get(key);
  if (cached) return cached;

  const schema = registeredSchemas.get(key);
  if (!schema) return null;

  const compiled = ajv.compile(schema);
  compiledSchemas.set(key, compiled);
  return compiled;
}

export function getJsonSchemaValidator(
  schemaKey: string,
  schema: Schema,
): ValidateFunction {
  const cached = compiledSchemaByKey.get(schemaKey);
  if (cached) return cached;

  const compiled = ajv.compile(schema);
  compiledSchemaByKey.set(schemaKey, compiled);
  return compiled;
}

export function outputSchemaCacheSize(): number {
  return compiledSchemas.size;
}

export function simplifyAjvErrors(
  errors: readonly ErrorObject[] | null | undefined,
): OutputSchemaValidationError[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? "schema validation failed",
    schemaPath: error.schemaPath,
  }));
}
