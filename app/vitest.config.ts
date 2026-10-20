import { defineConfig } from "vitest/config";

// Unit and integration tests live under src/. The browser suite (e2e/) runs with Playwright, not Vitest.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Threads, not forked processes: forked workers hit native crashes (0xC0000409) and ENOBUFS
    // socket errors from supertest servers in full runs (known issues 1 and 2). Threads passed clean runs.
    pool: "threads",
  },
});
