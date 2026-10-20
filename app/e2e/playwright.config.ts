import { defineConfig } from "@playwright/test";

// Browser suite (Task #15.4). Prerequisites, all local:
//   1. Database up and migrated (DATABASE_URL set).
//   2. E2E_PASSWORD set (12+ characters), then: npx tsx src/scripts/e2e-seed.ts
//   3. Web app built for the test API: NEXT_PUBLIC_API_URL=http://localhost:3002 npm --prefix web run build
// Then from app/: npm run e2e
const API = "http://localhost:3002";
const WEB = "http://localhost:3100";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000, // the UAT journeys run several sign-ins in sequence
  workers: 1, // the journeys share one database
  use: { baseURL: WEB, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "npx tsx src/server.ts",
      url: `${API}/health/live`,
      reuseExistingServer: true,
      env: { PORT: "3002", WEB_ORIGIN: WEB, NODE_ENV: "development", APP_TIMEZONE: "America/Toronto", REMINDER_SLOT_LOCAL_TIME: "09:00", PASSWORD_HASH_ALGORITHM: "argon2id", SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-local-session-secret-0001", DATABASE_URL: process.env.DATABASE_URL ?? "" },
      cwd: "..",
    },
    {
      command: "npx next start -p 3100",
      url: WEB,
      reuseExistingServer: true,
      cwd: "../web",
    },
  ],
});
