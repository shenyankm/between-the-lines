import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // `.test.tsx` must be listed too: an `*.test.ts`-only pattern silently
    // excludes every React component test from the run.
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/setupTests.ts",
        // Test-support code: fixtures, MSW handlers and assertion helpers.
        "src/testing/**",
        // Machine-generated OpenAPI contract; also excluded from lint/format.
        "src/generated/**",
        "src/vite-env.d.ts",
      ],
      thresholds: {
        // Measured baseline, not an aspiration: 586/827 statements and lines,
        // 28/39 functions and 140/154 branches. src/main.tsx is counted at 0%
        // on purpose - the composition root is only exercised by the Playwright
        // suite, and excluding it would flatter the number.
        lines: 70.85,
        statements: 70.85,
        functions: 71.79,
        branches: 90.9,
        // The HTTP boundary is fully covered today. Pinning it stops a new
        // uncovered branch in api.ts from hiding behind coverage elsewhere.
        "src/api.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
      },
    },
  },
});
