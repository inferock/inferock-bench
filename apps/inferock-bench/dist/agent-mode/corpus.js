const JS_REVISION = "d8cabd2cddcc2b20f0beb4e1d2d31ff946a93ccd";
const SPEC_REVISION = "77d50e4a40e93b90bf45fa610a2329087e4ca3d1";
export const AGENT_CODING_CORPUS = {
    corpusId: "agent-coding-corpus-exercism-js-v1",
    sourceSummary: "MIT-licensed Exercism JavaScript exercises with local node:test fixtures generated from canonical cases.",
    tasks: [
        task("hello-world", "Return the classic greeting.", {
            "hello-world.js": "export function hello() {\n  return \"\";\n}\n",
        }, `import test from "node:test";
import assert from "node:assert/strict";
import { hello } from "./hello-world.js";

test("hello world", () => {
  assert.equal(hello(), "Hello, World!");
});
`),
        task("two-fer", "Implement the two-fer phrase with a default name.", {
            "two-fer.js": "export function twoFer(name = \"\") {\n  return \"\";\n}\n",
        }, `import test from "node:test";
import assert from "node:assert/strict";
import { twoFer } from "./two-fer.js";

test("two-fer", () => {
  assert.equal(twoFer(), "One for you, one for me.");
  assert.equal(twoFer("Alice"), "One for Alice, one for me.");
});
`),
        task("leap", "Return whether a year is a leap year.", {
            "leap.js": "export function isLeap(year) {\n  return false;\n}\n",
        }, `import test from "node:test";
import assert from "node:assert/strict";
import { isLeap } from "./leap.js";

test("leap years", () => {
  assert.equal(isLeap(1996), true);
  assert.equal(isLeap(1900), false);
  assert.equal(isLeap(2000), true);
  assert.equal(isLeap(2015), false);
});
`),
        task("rna-transcription", "Transcribe DNA nucleotides to RNA and reject invalid input.", {
            "rna-transcription.js": "export function toRna(dna) {\n  return dna;\n}\n",
        }, `import test from "node:test";
import assert from "node:assert/strict";
import { toRna } from "./rna-transcription.js";

test("rna transcription", () => {
  assert.equal(toRna("ACGTGGTCTTAA"), "UGCACCAGAAUU");
  assert.throws(() => toRna("ACXT"), /invalid/i);
});
`),
        task("resistor-color", "Map resistor color names to numeric codes.", {
            "resistor-color.js": "export function colorCode(color) {\n  return -1;\n}\n",
        }, `import test from "node:test";
import assert from "node:assert/strict";
import { colorCode } from "./resistor-color.js";

test("resistor colors", () => {
  assert.equal(colorCode("black"), 0);
  assert.equal(colorCode("white"), 9);
  assert.throws(() => colorCode("infrared"), /unknown/i);
});
`),
        task("pangram", "Detect whether text includes every English alphabet letter.", {
            "pangram.js": "export function isPangram(sentence) {\n  return false;\n}\n",
        }, `import test from "node:test";
import assert from "node:assert/strict";
import { isPangram } from "./pangram.js";

test("pangram", () => {
  assert.equal(isPangram("The quick brown fox jumps over the lazy dog."), true);
  assert.equal(isPangram("Five quacking zephyrs jolt my wax bed."), true);
  assert.equal(isPangram("Hello from Inferock Bench."), false);
});
`),
    ],
};
function task(slug, prompt, files, testFile) {
    return {
        slug,
        license: "MIT",
        source: {
            repository: "https://github.com/exercism/javascript",
            revision: JS_REVISION,
            path: `exercises/practice/${slug}`,
        },
        canonicalData: {
            repository: "https://github.com/exercism/problem-specifications",
            revision: SPEC_REVISION,
            path: `exercises/${slug}/canonical-data.json`,
        },
        localTestRuntime: "node:test",
        prompt,
        files,
        testFile,
    };
}
export async function writeAgentCorpusWorkspace(input) {
    const { join } = await import("node:path");
    const { ensurePrivateDir, writePrivateTextFile } = await import("../private-files.js");
    const corpus = input.corpus ?? AGENT_CODING_CORPUS;
    await ensurePrivateDir(input.workspace);
    await writePrivateTextFile(join(input.workspace, "package.json"), `${JSON.stringify({
        type: "module",
        scripts: {
            test: "node --test",
        },
    }, null, 2)}\n`);
    await writePrivateTextFile(join(input.workspace, "README.md"), [
        "# Inferock Bench Agent Coding Corpus",
        "",
        "Fix the failing JavaScript exercises. Run `npm test` or `node --test` to verify.",
        "This workspace is a local scratch directory created for the benchmark run.",
        "",
    ].join("\n"));
    await writePrivateTextFile(join(input.workspace, "ATTRIBUTION.json"), `${JSON.stringify({
        corpusId: corpus.corpusId,
        sourceSummary: corpus.sourceSummary,
        tasks: corpus.tasks.map((task) => ({
            slug: task.slug,
            license: task.license,
            source: task.source,
            canonicalData: task.canonicalData,
            localTestRuntime: task.localTestRuntime,
        })),
    }, null, 2)}\n`);
    for (const taskEntry of corpus.tasks) {
        const taskDir = join(input.workspace, taskEntry.slug);
        await ensurePrivateDir(taskDir);
        await writePrivateTextFile(join(taskDir, "README.md"), `${taskEntry.prompt}\n`);
        for (const [path, content] of Object.entries(taskEntry.files)) {
            await writePrivateTextFile(join(taskDir, path), content);
        }
        await writePrivateTextFile(join(taskDir, `${taskEntry.slug}.test.js`), taskEntry.testFile);
    }
    return {
        taskCount: corpus.tasks.length,
        testCommand: ["node", "--test"],
    };
}
//# sourceMappingURL=corpus.js.map