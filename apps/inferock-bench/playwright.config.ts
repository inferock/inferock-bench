import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e/tests",
  testMatch: ["**/*.spec.ts"],
  outputDir: "./e2e/test-results",
  snapshotPathTemplate: "./e2e/__screenshots__/{arg}-{projectName}{ext}",
  fullyParallel: false,
  forbidOnly: CI,
  retries: 0,
  workers: CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  reporter: [["html", { open: "never", outputFolder: "e2e/results/html" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: ["--disable-dev-shm-usage"],
    },
  },
  projects: [
    {
      name: "functional",
      grep: /@functional/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "desktop",
      grep: /@visual/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "narrow",
      grep: /@visual/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
