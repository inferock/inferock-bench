import { Ajv, } from "ajv";
const ajv = new Ajv({ allErrors: true, strict: false });
const registeredSchemas = new Map();
const compiledSchemas = new Map();
const compiledSchemaByKey = new Map();
function schemaKey(tenantId, schemaVersion) {
    return `${tenantId}:${schemaVersion}`;
}
export function registerOutputSchema(input) {
    const key = schemaKey(input.tenantId, input.schemaVersion);
    registeredSchemas.set(key, input.schema);
    compiledSchemas.delete(key);
}
export function unregisterOutputSchema(tenantId, schemaVersion) {
    const key = schemaKey(tenantId, schemaVersion);
    registeredSchemas.delete(key);
    compiledSchemas.delete(key);
}
export function clearOutputSchemas() {
    registeredSchemas.clear();
    compiledSchemas.clear();
    compiledSchemaByKey.clear();
}
export function hasOutputSchema(tenantId, schemaVersion) {
    return registeredSchemas.has(schemaKey(tenantId, schemaVersion));
}
export function getOutputSchema(tenantId, schemaVersion) {
    return registeredSchemas.get(schemaKey(tenantId, schemaVersion)) ?? null;
}
export function getOutputValidator(tenantId, schemaVersion) {
    const key = schemaKey(tenantId, schemaVersion);
    const cached = compiledSchemas.get(key);
    if (cached)
        return cached;
    const schema = registeredSchemas.get(key);
    if (!schema)
        return null;
    const compiled = ajv.compile(schema);
    compiledSchemas.set(key, compiled);
    return compiled;
}
export function getJsonSchemaValidator(schemaKey, schema) {
    const cached = compiledSchemaByKey.get(schemaKey);
    if (cached)
        return cached;
    const compiled = ajv.compile(schema);
    compiledSchemaByKey.set(schemaKey, compiled);
    return compiled;
}
export function outputSchemaCacheSize() {
    return compiledSchemas.size;
}
export function simplifyAjvErrors(errors) {
    return (errors ?? []).map((error) => ({
        instancePath: error.instancePath,
        keyword: error.keyword,
        message: error.message ?? "schema validation failed",
        schemaPath: error.schemaPath,
    }));
}
//# sourceMappingURL=output-schemas.js.map