#!/usr/bin/env node
import { deriveCoverageTokenBaselineFromCovrun } from "./baseline.js";
import { loadCoverageSuiteManifest } from "./manifest.js";
const isMain = process.argv[1]?.endsWith("derive-token-baseline.js") ||
    process.argv[1]?.endsWith("derive-token-baseline.ts");
if (isMain) {
    run().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
async function run() {
    const reportPath = requiredArg("--report");
    const preconditionsPath = requiredArg("--preconditions");
    const sourcePath = requiredArg("--source-path");
    const outputPath = requiredArg("--output");
    const suite = await loadCoverageSuiteManifest();
    await deriveCoverageTokenBaselineFromCovrun({
        suite,
        reportPath,
        preconditionsPath,
        sourcePath,
        outputPath,
    });
    console.log(`Wrote coverage token baseline: ${outputPath}`);
}
function requiredArg(flag) {
    const index = process.argv.indexOf(flag);
    const value = index === -1 ? undefined : process.argv[index + 1];
    if (!value)
        throw new Error(`Missing ${flag}.`);
    return value;
}
//# sourceMappingURL=derive-token-baseline.js.map