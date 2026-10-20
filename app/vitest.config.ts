import { defineConfig } from "vitest/config";

// Unit and integration tests live under src/. The browser suite (e2e/) runs with Playwright, not Vitest.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Two workers: with 25 parallel workers on Windows, native worker crashes (0xC0000409) and
    // ENOBUFS socket errors from supertest servers appeared in full runs (known issues 1 and 2).
    maxWorkers: 2,
  },
});
