import { createHash } from "node:crypto";
export function canonicalJson(value) {
    return JSON.stringify(canonicalValue(value));
}
export function stableSha256(value) {
    return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
function canonicalValue(value) {
    if (Array.isArray(value))
        return value.map(canonicalValue);
    if (!isPlainRecord(value))
        return value;
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
        const child = value[key];
        if (child !== undefined)
            sorted[key] = canonicalValue(child);
    }
    return sorted;
}
function isPlainRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=canonical-json.js.map