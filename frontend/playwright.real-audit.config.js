import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "ending-audit.spec.ts",
  grep: /ending audit (rules|professional|repair|exit|cost|unresolved)$/,
  globalSetup: "./e2e/real-global-setup.ts",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 30000 },
  use: {
    baseURL: "http://localhost:18081",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "real-desktop", use: { ...devices["Desktop Chrome"] } }],
});
