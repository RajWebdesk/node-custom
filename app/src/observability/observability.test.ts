import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../api/app.js";
import { Metrics, type LogLine, type Logger } from "./observability.js";

class CapturingLogger implements Logger {
  readonly lines: LogLine[] = [];
  log(line: LogLine): void {
    this.lines.push(line);
  }
}

// Readiness depends on the startup configuration, so give it a valid one for these tests.
function withValidConfig<T>(fn: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://app:unused@localhost:1/unused",
    SESSION_SECRET: "readiness-test-secret-0123456789",
    PASSWORD_HASH_ALGORITHM: "argon2id",
    REMINDER_SLOT_LOCAL_TIME: "09:00",
    APP_TIMEZONE: "America/Toronto",
  });
  return fn().finally(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
}

describe("health and readiness (G5.5)", () => {
  it("liveness answers while the process runs, whatever the database does", async () => {
    const app = createApp({ dbCheck: async () => { throw new Error("down"); } });
    expect((await request(app).get("/health/live")).status).toBe(200);
  });

  it("readiness is ready only when the configuration is valid and the database answers", async () => {
    await withValidConfig(async () => {
      const ok = createApp({ dbCheck: async () => undefined });
      expect((await request(ok).get("/health/ready")).status).toBe(200);

      const down = createApp({ dbCheck: async () => { throw new Error("connect ECONNREFUSED 10.0.0.5:5432"); } });
      const res = await request(down).get("/health/ready");
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: "not-ready", database: "unreachable" });
      // The error text, host, and port never reach the response.
      expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.5|ECONNREFUSED/);
    });
  });

  it("readiness times out a database check that hangs", async () => {
    await withValidConfig(async () => {
      const hangs = createApp({ dbCheck: () => new Promise<void>(() => undefined) });
      const started = Date.now();
      const res = await request(hangs).get("/health/ready");
      expect(res.status).toBe(503);
      expect(Date.now() - started).toBeLessThan(4000);
    });
  });
});

describe("structured request log (G5.5)", () => {
  it("writes one JSON line per request with the route pattern and status, and no secrets", async () => {
    const logger = new CapturingLogger();
    const app = createApp({ logger });
    await request(app)
      .post("/api/v1/auth/login")
      .set("Cookie", "sid=super-secret-session-value")
      .set("X-CSRF-Token", "super-secret-csrf-value")
      .send({ email: "someone@example.test", password: "super-secret-password" });

    const line = logger.lines.find((l) => l.msg === "http_request");
    expect(line).toMatchObject({ method: "POST", route: "/api/v1/auth/login", status: 401 });
    expect(typeof line!.request_id).toBe("string");
    const text = JSON.stringify(logger.lines);
    expect(text).not.toMatch(/super-secret|someone@example\.test/);
  });

  it("logs unknown paths as unmatched, so arbitrary URLs and IDs never reach the log", async () => {
    const logger = new CapturingLogger();
    const app = createApp({ logger });
    await request(app).get("/api/v1/tasks/some-private-task-id-12345?token=abc");
    const line = logger.lines.find((l) => l.msg === "http_request");
    expect(line!.route).toBe("/api/v1/tasks/:taskId");
    expect(JSON.stringify(logger.lines)).not.toMatch(/some-private-task-id|token=abc/);
  });

  it("echoes a clean request id and replaces an unsafe one", async () => {
    const app = createApp({ logger: new CapturingLogger() });
    const clean = await request(app).get("/health/live").set("X-Request-Id", "abc12345-clean");
    expect(clean.headers["x-request-id"]).toBe("abc12345-clean");
    const unsafe = await request(app).get("/health/live").set("X-Request-Id", "bad id with spaces <script>");
    expect(unsafe.headers["x-request-id"]).not.toMatch(/[ <>]/);
  });
});

describe("exported metrics (G5.5)", () => {
  it("counts requests by method, route pattern, and status", async () => {
    const metrics = new Metrics();
    const app = createApp({ metrics, logger: new CapturingLogger() });
    await request(app).get("/health/live");
    await request(app).get("/health/live");
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain('http_requests_total{method="GET",route="/health/live",status="200"} 2');
    expect(res.text).toContain("http_request_duration_ms_sum");
  });
});
