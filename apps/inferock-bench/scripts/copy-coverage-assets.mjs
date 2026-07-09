import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const assets = [
  ["src/coverage-suite/inferock-coverage-suite-v1.json", "dist/coverage-suite/inferock-coverage-suite-v1.json"],
  ["src/coverage-suite/baselines/coverage-suite-v1.tokens.json", "dist/coverage-suite/baselines/coverage-suite-v1.tokens.json"],
  ["src/drift-canary/inferock-drift-canary-v1.json", "dist/drift-canary/inferock-drift-canary-v1.json"],
  ["src/drift-canary/METHOD.md", "dist/drift-canary/METHOD.md"],
  ["src/drift-canary/THIRD_PARTY_LICENSES.md", "dist/drift-canary/THIRD_PARTY_LICENSES.md"],
  ["src/agent-mode/CORPUS-NOTICE.md", "dist/agent-mode/CORPUS-NOTICE.md"],
  ["src/agent-mode/CORPUS-MANIFEST.json", "dist/agent-mode/CORPUS-MANIFEST.json"],
  ["src/conformance/__fixtures__/stream", "dist/conformance/__fixtures__/stream"],
];

for (const [source, target] of assets) {
  const absoluteSource = resolve(source);
  if (!existsSync(absoluteSource)) {
    throw new Error(`Missing inferock-bench build asset: ${source}`);
  }
  const absoluteTarget = resolve(target);
  mkdirSync(dirname(absoluteTarget), { recursive: true });
  cpSync(absoluteSource, absoluteTarget, { recursive: true });
}
