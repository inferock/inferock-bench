// Copied from apps/proxy/src/adapters/gemini-schema.ts for inferock-bench Track C.
import { isRecord } from "../record.js";
const GEMINI_SCHEMA_SUPPORTED_KEYWORDS = new Set([
    "type",
    "format",
    "description",
    "nullable",
    "enum",
    "maxItems",
    "minItems",
    "properties",
    "required",
    "propertyOrdering",
    "items",
    "minimum",
    "maximum",
    "anyOf",
]);
export function sanitizeGeminiGenerateContentPayload(body) {
    const changes = [];
    const payload = {};
    for (const [key, value] of Object.entries(body)) {
        if (key === "model" || key === "stream")
            continue;
        if (key === "tools" && Array.isArray(value)) {
            payload.tools = sanitizeGeminiTools(value, "tools", changes);
            continue;
        }
        if (key === "generationConfig" && isRecord(value)) {
            payload.generationConfig = sanitizeGeminiGenerationConfig(value, "generationConfig", changes);
            continue;
        }
        payload[key] = cloneJson(value);
    }
    return { payload, changes };
}
export function geminiSchemaSanitizationEvidence(changes) {
    if (changes.length === 0)
        return undefined;
    return {
        provider: "gemini",
        source: "adapter_boundary",
        schemaDialect: "gemini_openapi_subset",
        sentSchemaIsCanonical: true,
        changes: changes.map((change) => ({
            path: change.path,
            keyword: change.keyword,
            action: change.action,
            reason: change.reason,
        })),
    };
}
function sanitizeGeminiTools(tools, path, changes) {
    return tools.map((tool, toolIndex) => {
        if (!isRecord(tool))
            return cloneJson(tool);
        const output = {};
        for (const [key, value] of Object.entries(tool)) {
            if (key === "functionDeclarations" && Array.isArray(value)) {
                output.functionDeclarations = value.map((declaration, declarationIndex) => sanitizeGeminiFunctionDeclaration(declaration, `${path}[${toolIndex}].functionDeclarations[${declarationIndex}]`, changes));
                continue;
            }
            output[key] = cloneJson(value);
        }
        return output;
    });
}
function sanitizeGeminiFunctionDeclaration(declaration, path, changes) {
    if (!isRecord(declaration))
        return cloneJson(declaration);
    const output = {};
    for (const [key, value] of Object.entries(declaration)) {
        if ((key === "parameters" || key === "parametersJsonSchema") && isRecord(value)) {
            output[key] = sanitizeGeminiSchema(value, `${path}.${key}`, changes);
            continue;
        }
        output[key] = cloneJson(value);
    }
    return output;
}
function sanitizeGeminiGenerationConfig(generationConfig, path, changes) {
    const output = {};
    for (const [key, value] of Object.entries(generationConfig)) {
        if ((key === "responseSchema" || key === "responseJsonSchema" || key === "_responseJsonSchema") &&
            isRecord(value)) {
            output[key] = sanitizeGeminiSchema(value, `${path}.${key}`, changes);
            continue;
        }
        output[key] = cloneJson(value);
    }
    return output;
}
function sanitizeGeminiSchema(schema, path, changes) {
    const output = {};
    let nullableFromType = false;
    for (const [key, value] of Object.entries(schema)) {
        if (key === "const") {
            if (!Object.prototype.hasOwnProperty.call(schema, "enum")) {
                output.enum = [cloneJson(value)];
                recordChange(changes, path, key, "rewritten", "const maps to Gemini enum with one value.");
            }
            else {
                recordChange(changes, path, key, "removed", "Gemini schema uses enum instead of const.");
            }
            continue;
        }
        if (key === "type") {
            const normalized = normalizeGeminiType(value);
            if (normalized.type !== undefined)
                output.type = normalized.type;
            if (normalized.nullable)
                nullableFromType = true;
            if (normalized.action) {
                recordChange(changes, path, key, normalized.action, normalized.reason);
            }
            continue;
        }
        if (key === "properties") {
            if (isRecord(value)) {
                output.properties = sanitizeGeminiProperties(value, `${path}.properties`, changes);
            }
            else {
                recordChange(changes, path, key, "removed", "Gemini properties must be an object.");
            }
            continue;
        }
        if (key === "items") {
            const sanitizedItems = sanitizeGeminiItems(value, `${path}.items`, changes);
            if (sanitizedItems !== undefined)
                output.items = sanitizedItems;
            continue;
        }
        if (key === "anyOf") {
            if (Array.isArray(value)) {
                output.anyOf = value
                    .map((entry, index) => isRecord(entry)
                    ? sanitizeGeminiSchema(entry, `${path}.anyOf[${index}]`, changes)
                    : undefined)
                    .filter((entry) => entry !== undefined);
            }
            else {
                recordChange(changes, path, key, "removed", "Gemini anyOf must be an array of schema objects.");
            }
            continue;
        }
        if (!GEMINI_SCHEMA_SUPPORTED_KEYWORDS.has(key)) {
            recordChange(changes, path, key, "removed", "Gemini Developer API schema is a limited OpenAPI subset, not full JSON Schema.");
            continue;
        }
        output[key] = cloneJson(value);
    }
    if (nullableFromType)
        output.nullable = true;
    return output;
}
function sanitizeGeminiProperties(properties, path, changes) {
    const output = {};
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
        output[propertyName] = isRecord(propertySchema)
            ? sanitizeGeminiSchema(propertySchema, `${path}.${propertyName}`, changes)
            : cloneJson(propertySchema);
    }
    return output;
}
function sanitizeGeminiItems(value, path, changes) {
    if (isRecord(value))
        return sanitizeGeminiSchema(value, path, changes);
    if (Array.isArray(value)) {
        const firstSchema = value.find(isRecord);
        recordChange(changes, path, "items", "rewritten", "Gemini supports a single item schema, not tuple-style JSON Schema items.");
        return firstSchema ? sanitizeGeminiSchema(firstSchema, path, changes) : undefined;
    }
    recordChange(changes, path, "items", "removed", "Gemini items must be a schema object.");
    return undefined;
}
function normalizeGeminiType(value) {
    if (!Array.isArray(value)) {
        return { type: cloneJson(value), nullable: false, reason: "" };
    }
    const nonNullTypes = value.filter((entry) => entry !== "null");
    if (nonNullTypes.length === 1) {
        return {
            type: cloneJson(nonNullTypes[0]),
            nullable: nonNullTypes.length !== value.length,
            action: "rewritten",
            reason: "Gemini represents nullable single-type schemas with nullable: true.",
        };
    }
    return {
        nullable: nonNullTypes.length !== value.length,
        action: "removed",
        reason: "Gemini type must be a single OpenAPI type.",
    };
}
function recordChange(changes, parentPath, keyword, action, reason) {
    changes.push({
        path: `${parentPath}.${keyword}`,
        keyword,
        action,
        reason,
    });
}
function cloneJson(value) {
    if (Array.isArray(value))
        return value.map(cloneJson);
    if (!isRecord(value))
        return value;
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry !== undefined)
            output[key] = cloneJson(entry);
    }
    return output;
}
//# sourceMappingURL=gemini-schema.js.map