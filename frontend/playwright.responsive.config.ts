import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "responsive.spec.ts",
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 90000,
  outputDir: "test-results/responsive",
  reporter: [
    ["list"],
    ["json", { outputFile: "../artifacts/responsive/results.json" }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5174",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: ["chromium", "firefox", "webkit"].map((browserName) => ({
    name: browserName,
    use: { browserName: browserName as "chromium" | "firefox" | "webkit" },
  })),
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "corepack pnpm dev --port 5174 --strictPort",
        url: "http://127.0.0.1:5174",
        reuseExistingServer: !process.env.CI,
      },
});
