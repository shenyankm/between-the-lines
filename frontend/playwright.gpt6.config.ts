import { defineConfig, devices } from "@playwright/test";

// Separate opt-in config prevents the mock suite from consuming real credits.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "gpt6-live.spec.ts",
  workers: 1,
  reporter: "list",
  timeout: 180_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173",
    trace: "off",
    screenshot: "off",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
