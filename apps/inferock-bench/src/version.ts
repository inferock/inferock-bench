import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const BENCH_PACKAGE_VERSION = packageVersion(require("../package.json") as unknown);

function packageVersion(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    typeof value.version === "string" &&
    value.version.length > 0
  ) {
    return value.version;
  }
  throw new Error("inferock-bench package version is missing.");
}
