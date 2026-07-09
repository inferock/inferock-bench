import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/__integration__/**"],
    pool: "forks",
    poolOptions: { forks: { singleFork: false, maxForks: 4 } },
    fileParallelism: true,
    isolate: true,
    retries: 0,
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "cobertura"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/__integration__/**"],
    },
  },
});
