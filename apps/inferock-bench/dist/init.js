import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DEFAULT_HOST, DEFAULT_PORT } from "./config.js";
import { isRecord } from "./record.js";
export async function runInit(options) {
    const log = options.log ?? console.log;
    const host = options.host ?? DEFAULT_HOST;
    const port = options.port ?? DEFAULT_PORT;
    const benchKey = options.benchKey ?? "your-dashboard-bench-key";
    const detected = await detectSdks(options.cwd);
    if (detected.length === 0) {
        log("No supported SDK dependency found in package.json.");
        log("Supported packages: openai, @anthropic-ai/sdk.");
    }
    else {
        log(`Detected SDKs: ${detected.join(", ")}`);
    }
    for (const sdk of detected) {
        log("");
        log(instructionForSdk(sdk, host, port, benchKey));
    }
    log("");
    log(`Start the local dashboard: npx inferock-bench start --port ${port}`);
    log(`Open http://${host}:${port}/, save your provider key locally, then copy your local bench key.`);
    log(`Set your SDK apiKey to process.env.INFEROCK_BENCH_KEY ?? "${benchKey}".`);
    log("Provider keys are not sent to Inferock; attached only to provider requests.");
    log("The proxy prints `first call measured ✓` after the first successful proxied call.");
    if (!options.patchFile)
        return { detected };
    const patchTarget = resolve(options.cwd, options.patchFile);
    if (!options.yes && !await confirmPatch(patchTarget))
        return { detected };
    const patchResult = await patchClientFile(patchTarget, detected, host, port, benchKey);
    for (const message of patchResult.messages)
        log(message);
    if (!patchResult.patched) {
        throw new Error(`Refused to patch ${patchTarget}. ${patchResult.messages.join(" ")}`);
    }
    log(`Patched ${patchTarget}`);
    return { detected, patchedFile: patchTarget };
}
export async function detectSdks(cwd) {
    const packageJson = await readPackageJson(cwd);
    const dependencies = packageJson ? dependencyNames(packageJson) : new Set();
    const detected = [];
    if (dependencies.has("openai"))
        detected.push("openai");
    if (dependencies.has("@anthropic-ai/sdk"))
        detected.push("anthropic");
    return detected;
}
function instructionForSdk(sdk, host, port, benchKey) {
    if (sdk === "openai") {
        return [
            "OpenAI SDK change:",
            "const openai = new OpenAI({",
            `  apiKey: process.env.INFEROCK_BENCH_KEY ?? "${benchKey}",`,
            `  baseURL: "http://${host}:${port}/v1",`,
            "});",
        ].join("\n");
    }
    return [
        "Anthropic SDK change:",
        "const anthropic = new Anthropic({",
        `  apiKey: process.env.INFEROCK_BENCH_KEY ?? "${benchKey}",`,
        `  baseURL: "http://${host}:${port}",`,
        "});",
    ].join("\n");
}
async function readPackageJson(cwd) {
    try {
        const raw = await readFile(join(cwd, "package.json"), "utf8");
        const parsed = JSON.parse(raw);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
function dependencyNames(packageJson) {
    const names = new Set();
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const value = packageJson[field];
        if (!isRecord(value))
            continue;
        for (const name of Object.keys(value))
            names.add(name);
    }
    return names;
}
async function patchClientFile(filePath, detected, host, port, benchKey) {
    const raw = await readFile(filePath, "utf8");
    const operations = [];
    const messages = [];
    if (detected.includes("openai")) {
        collectConstructorPatch({
            source: raw,
            constructorName: "OpenAI",
            baseUrl: `http://${host}:${port}/v1`,
            benchKey,
            operations,
            messages,
        });
    }
    if (detected.includes("anthropic")) {
        collectConstructorPatch({
            source: raw,
            constructorName: "Anthropic",
            baseUrl: `http://${host}:${port}`,
            benchKey,
            operations,
            messages,
        });
    }
    if (messages.some((message) => message.startsWith("Refused"))) {
        return { patched: false, messages };
    }
    if (operations.length === 0) {
        return {
            patched: false,
            messages: [
                "Refused: no `new OpenAI({ ... })` or `new Anthropic({ ... })` constructor was found to patch.",
            ],
        };
    }
    const next = applyPatchOperations(raw, operations);
    if (next === raw) {
        return {
            patched: false,
            messages: [
                "Refused: the file already appeared to contain the expected local bench key and baseURL.",
            ],
        };
    }
    await writeFile(filePath, next, "utf8");
    return {
        patched: true,
        messages: [
            "Updated SDK apiKey to use the local ibl_ bench key.",
            "Updated SDK baseURL to point at the local inferock-bench proxy.",
        ],
    };
}
function collectConstructorPatch(input) {
    const spans = constructorObjectSpans(input.source, input.constructorName, input.messages);
    for (const span of spans) {
        collectOptionsObjectPatch({
            source: input.source,
            span,
            constructorName: input.constructorName,
            baseUrl: input.baseUrl,
            benchKey: input.benchKey,
            operations: input.operations,
            messages: input.messages,
        });
    }
}
function constructorObjectSpans(source, constructorName, messages) {
    const spans = [];
    let searchStart = 0;
    while (searchStart < source.length) {
        const match = findNextConstructor(source, constructorName, searchStart);
        if (!match)
            break;
        const openParen = skipWhitespace(source, match.afterName);
        if (source[openParen] !== "(") {
            searchStart = match.afterName;
            continue;
        }
        const openBrace = skipWhitespace(source, openParen + 1);
        if (source[openBrace] !== "{") {
            messages.push(`Refused: new ${constructorName}(...) in the patch target does not use an object-literal options block.`);
            searchStart = openParen + 1;
            continue;
        }
        const closeBrace = findMatchingBrace(source, openBrace);
        if (closeBrace === undefined) {
            messages.push(`Refused: could not find the end of new ${constructorName}({ ... }).`);
            searchStart = openBrace + 1;
            continue;
        }
        const closeParen = skipWhitespace(source, closeBrace + 1);
        if (source[closeParen] !== ")") {
            messages.push(`Refused: new ${constructorName}({ ... }) has extra syntax after the options object; patch it by hand.`);
            searchStart = closeBrace + 1;
            continue;
        }
        spans.push({ openBrace, closeBrace });
        searchStart = closeBrace + 1;
    }
    return spans;
}
function collectOptionsObjectPatch(input) {
    const segments = topLevelPropertySegments(input.source, input.span.openBrace + 1, input.span.closeBrace);
    const apiKeySegments = segments.filter((segment) => propertyName(input.source, segment) === "apiKey");
    const baseUrlSegments = segments.filter((segment) => propertyName(input.source, segment) === "baseURL");
    if (apiKeySegments.length > 1 || baseUrlSegments.length > 1) {
        input.messages.push(`Refused: new ${input.constructorName}({ ... }) has duplicate apiKey or baseURL fields.`);
        return;
    }
    const apiKeyLine = `apiKey: process.env.INFEROCK_BENCH_KEY ?? ${JSON.stringify(input.benchKey)}`;
    const baseUrlLine = `baseURL: ${JSON.stringify(input.baseUrl)}`;
    const indent = inferPropertyIndent(input.source, input.span.openBrace, input.span.closeBrace);
    const missingLines = [];
    if (apiKeySegments[0]) {
        const currentApiKey = propertyValueExpression(input.source, apiKeySegments[0]);
        if (!currentApiKey || !isSimpleApiKeyExpression(currentApiKey)) {
            input.messages.push(manualPatchRefusal(input.constructorName, apiKeyLine, baseUrlLine));
            return;
        }
        input.operations.push(replaceProperty(input.source, apiKeySegments[0], apiKeyLine));
    }
    else {
        missingLines.push(`${apiKeyLine},`);
    }
    if (baseUrlSegments[0]) {
        input.operations.push(replaceProperty(input.source, baseUrlSegments[0], baseUrlLine));
    }
    else {
        missingLines.push(`${baseUrlLine},`);
    }
    if (missingLines.length > 0) {
        input.operations.push(insertProperties(input.source, input.span.openBrace, indent, missingLines));
    }
}
function replaceProperty(source, segment, replacement) {
    const current = source.slice(segment.start, segment.end);
    const leading = current.match(/^\s*/)?.[0] ?? "";
    return {
        start: segment.start,
        end: segment.end,
        text: `${leading}${replacement}`,
    };
}
function insertProperties(source, openBrace, indent, lines) {
    const trailingNewline = source[openBrace + 1] === "\n" ? "" : "\n";
    return {
        start: openBrace + 1,
        end: openBrace + 1,
        text: `\n${lines.map((line) => `${indent}${line}`).join("\n")}${trailingNewline}`,
    };
}
function applyPatchOperations(source, operations) {
    return [...operations]
        .sort((left, right) => right.start - left.start)
        .reduce((next, operation) => `${next.slice(0, operation.start)}${operation.text}${next.slice(operation.end)}`, source);
}
function propertyName(source, segment) {
    const text = source.slice(segment.start, segment.end).trimStart();
    const match = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:/.exec(text);
    const name = match?.[1] ?? match?.[2] ?? match?.[3];
    return name === "apiKey" || name === "baseURL" ? name : undefined;
}
function propertyValueExpression(source, segment) {
    const text = source.slice(segment.start, segment.end).trimStart();
    const match = /^(?:"[^"]+"|'[^']+'|[A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/.exec(text);
    return match?.[1]?.trim();
}
function isSimpleApiKeyExpression(expression) {
    const stringLiteral = String.raw `(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`;
    const envReference = String.raw `process\.env\.[A-Za-z_$][\w$]*`;
    return new RegExp(`^(?:${stringLiteral}|${envReference}(?:\\s*\\?\\?\\s*${stringLiteral})?)$`)
        .test(expression);
}
function manualPatchRefusal(constructorName, apiKeyLine, baseUrlLine) {
    return [
        `Refused: new ${constructorName}({ ... }) has an apiKey expression that is not a string literal or process.env.X reference.`,
        "Patch it manually with:",
        `  ${apiKeyLine},`,
        `  ${baseUrlLine},`,
    ].join("\n");
}
function inferPropertyIndent(source, openBrace, closeBrace) {
    const content = source.slice(openBrace + 1, closeBrace);
    const existingIndent = /\n([ \t]*)\S/.exec(content)?.[1];
    if (existingIndent !== undefined)
        return existingIndent;
    const lineStart = source.lastIndexOf("\n", openBrace) + 1;
    const constructorIndent = source.slice(lineStart, openBrace).match(/^[ \t]*/)?.[0] ?? "";
    return `${constructorIndent}  `;
}
function topLevelPropertySegments(source, start, end) {
    const segments = [];
    let segmentStart = start;
    let state = "code";
    let depth = 0;
    for (let index = start; index < end; index += 1) {
        const nextState = nextScanState(source, index, state);
        if (state === "code") {
            const char = source[index];
            if (char === "{" || char === "[" || char === "(")
                depth += 1;
            if (char === "}" || char === "]" || char === ")")
                depth -= 1;
            if (char === "," && depth === 0) {
                segments.push({ start: segmentStart, end: index });
                segmentStart = index + 1;
            }
        }
        state = nextState;
    }
    segments.push({ start: segmentStart, end });
    return segments.filter((segment) => source.slice(segment.start, segment.end).trim().length > 0);
}
function findNextConstructor(source, constructorName, start) {
    let state = "code";
    for (let index = start; index < source.length; index += 1) {
        if (state === "code" &&
            source.startsWith("new", index) &&
            !isIdentifierChar(source[index - 1]) &&
            !isIdentifierChar(source[index + 3])) {
            const nameStart = skipWhitespace(source, index + 3);
            const afterName = nameStart + constructorName.length;
            if (source.startsWith(constructorName, nameStart) &&
                !isIdentifierChar(source[afterName])) {
                return { afterName };
            }
        }
        state = nextScanState(source, index, state);
    }
    return undefined;
}
function findMatchingBrace(source, openBrace) {
    let state = "code";
    let depth = 0;
    for (let index = openBrace; index < source.length; index += 1) {
        const nextState = nextScanState(source, index, state);
        if (state === "code") {
            const char = source[index];
            if (char === "{")
                depth += 1;
            if (char === "}") {
                depth -= 1;
                if (depth === 0)
                    return index;
            }
        }
        state = nextState;
    }
    return undefined;
}
function nextScanState(source, index, state) {
    const char = source[index];
    const next = source[index + 1];
    const previous = source[index - 1];
    if (state === "lineComment")
        return char === "\n" ? "code" : state;
    if (state === "blockComment")
        return char === "*" && next === "/" ? "code" : state;
    if (state === "singleQuote")
        return char === "'" && previous !== "\\" ? "code" : state;
    if (state === "doubleQuote")
        return char === "\"" && previous !== "\\" ? "code" : state;
    if (state === "template")
        return char === "`" && previous !== "\\" ? "code" : state;
    if (char === "/" && next === "/")
        return "lineComment";
    if (char === "/" && next === "*")
        return "blockComment";
    if (char === "'")
        return "singleQuote";
    if (char === "\"")
        return "doubleQuote";
    if (char === "`")
        return "template";
    return "code";
}
function skipWhitespace(source, start) {
    let index = start;
    while (/\s/.test(source[index] ?? ""))
        index += 1;
    return index;
}
function isIdentifierChar(char) {
    return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}
async function confirmPatch(filePath) {
    const rl = createInterface({ input, output });
    try {
        const answer = await rl.question(`Patch ${filePath}? Type APPLY to continue: `);
        return answer.trim() === "APPLY";
    }
    finally {
        rl.close();
    }
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
//# sourceMappingURL=init.js.map