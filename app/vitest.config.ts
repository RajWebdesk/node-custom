import { defineConfig } from "vitest/config";

// Unit and integration tests live under src/. The browser suite (e2e/) runs with Playwright, not Vitest.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
