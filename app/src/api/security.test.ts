import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import type { UserRecord, UserStore } from "./auth.js";
import type { UserAdminStore } from "../auth/reset.js";

// Task #15.2: security validation. Negative tests across every route: no session, no CSRF token, wrong role,
// other people's records, bad input, and session lifecycle. Written as tables so that a new route is easy to add.
const PASSWORD = "security-test-password-1";

async function setup() {
  const hash = await hashPassword(PASSWORD);
  const base = { passwordHash: hash, status: "active" as const, isDesignatedReviewer: false };
  const records: UserRecord[] = [
    { ...base, id: "u-admin", email: "admin@example.test", roles: ["ADMINISTRATOR"] },
    { ...base, id: "u-manager", email: "manager@example.test", roles: ["MANAGER"] },
    { ...base, id: "u-reviewer", email: "reviewer@example.test", roles: ["MANAGER"], isDesignatedReviewer: true },
    { ...base, id: "u-emp", email: "emp@example.test", roles: ["EMPLOYEE"] },
    { ...base, id: "u-other", email: "other@example.test", roles: ["EMPLOYEE"] },
  ];
  const users: UserStore = { findByEmail: async (e) => records.find((r) => r.email === e) ?? null };
  const userAdmin: UserAdminStore = {
    findById: async (id) => {
      const r = records.find((x) => x.id === id);
      return r ? { id: r.id, roles: r.roles, isDesignatedReviewer: r.isDesignatedReviewer } : null;
    },
    setPasswordHash: async () => undefined,
    getPasswordHash: async () => null,
  };
  const seed: UserView[] = records.map((r) => ({
    id: r.id, name: r.id, email: r.email, roles: r.roles, status: r.status, isDesignatedReviewer: r.isDesignatedReviewer,
  }));
  const sessions = new InMemorySessionStore();
  const app = createApp({ users, sessions, userAdmin, userDirectory: new InMemoryUserDirectory(seed) });
  return { app, sessions };
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
  return { cookie, csrf: res.body.csrfToken as string };
}

// Every route the API serves that needs a signed-in user. "method" and "path" are literal; ":x" stands for an id.
const PROTECTED = [
  { method: "get", path: "/api/v1/me" },
  { method: "patch", path: "/api/v1/me", body: { name: "x" }, write: true },
  { method: "post", path: "/api/v1/me/password", body: {}, write: true },
  { method: "get", path: "/api/v1/tasks" },
  { method: "post", path: "/api/v1/tasks", body: {}, write: true },
  { method: "get", path: "/api/v1/tasks/:id" },
  { method: "patch", path: "/api/v1/tasks/:id", body: { title: "x" }, write: true },
  { method: "post", path: "/api/v1/tasks/:id/status", body: { status: "In Progress" }, write: true },
  { method: "get", path: "/api/v1/tasks/:id/history" },
  { method: "post", path: "/api/v1/tasks/:id/submissions", body: {}, write: true },
  { method: "get", path: "/api/v1/tasks/:id/reviews" },
  { method: "get", path: "/api/v1/reviews" },
  { method: "get", path: "/api/v1/submissions/:id" },
  { method: "post", path: "/api/v1/submissions/:id/decisions", body: { decision: "approve" }, write: true },
  { method: "get", path: "/api/v1/allocations" },
  { method: "get", path: "/api/v1/allocations/:id/history" },
  { method: "post", path: "/api/v1/admin/allocations/:id/adjust", body: { mode: "set", hours: 1 }, write: true },
  { method: "get", path: "/api/v1/directory/users" },
  { method: "get", path: "/api/v1/dashboard" },
  { method: "get", path: "/api/v1/reports/tasks" },
  { method: "get", path: "/api/v1/reports/time" },
  { method: "get", path: "/api/v1/reports/history" },
  { method: "get", path: "/api/v1/notifications" },
  { method: "post", path: "/api/v1/notifications/read-all", body: {}, write: true },
  { method: "post", path: "/api/v1/notifications/:id/read", body: {}, write: true },
  { method: "get", path: "/api/v1/activity" },
  { method: "get", path: "/api/v1/admin/users" },
  { method: "post", path: "/api/v1/admin/users", body: { name: "x", email: "x@example.test", roles: ["EMPLOYEE"] }, write: true },
  { method: "patch", path: "/api/v1/admin/users/:id", body: { name: "x" }, write: true },
  { method: "post", path: "/api/v1/admin/users/:id/reset-token", body: {}, write: true },
  { method: "get", path: "/api/v1/admin/settings" },
] as const;

const PUBLIC_NO_SESSION = [
  { method: "get", path: "/health/live" },
  { method: "get", path: "/health/ready" },
  { method: "get", path: "/metrics" },
] as const;

function send(app: ReturnType<typeof createApp>, r: { method: string; path: string; body?: object }, who?: { cookie: string; csrf?: string }) {
  const path = r.path.replace(":id", "u-emp");
  let req = request(app)[r.method as "get"](path);
  if (who) req = req.set("Cookie", who.cookie);
  if (who?.csrf) req = req.set("X-CSRF-Token", who.csrf);
  return r.body !== undefined ? req.send(r.body) : req;
}

describe("authentication on every route (Task #15.2)", () => {
  it("answers 401 to every protected route without a session", async () => {
    const { app } = await setup();
    for (const r of PROTECTED) {
      const res = await send(app, r);
      expect(res.status, `${r.method.toUpperCase()} ${r.path}`).toBe(401);
    }
  });

  it("does not require a session for the public routes", async () => {
    const { app } = await setup();
    for (const r of PUBLIC_NO_SESSION) {
      const res = await request(app)[r.method](r.path);
      // Readiness may report 503 when no startup configuration is set (tested in observability). It must not ask for a session.
      expect([200, 503], `${r.method.toUpperCase()} ${r.path}`).toContain(res.status);
      expect(res.status).not.toBe(401);
    }
  });

  it("answers 401 to a forged or unknown session cookie", async () => {
    const { app } = await setup();
    for (const cookie of ["sid=not-a-real-session", "sid=", "other=1"]) {
      const res = await request(app).get("/api/v1/me").set("Cookie", cookie);
      expect(res.status, cookie).toBe(401);
    }
  });
});

describe("CSRF on every state-changing route (Task #15.2)", () => {
  it("refuses every write without the CSRF token, even with a valid session", async () => {
    const { app } = await setup();
    const admin = await login(app, "admin@example.test");
    for (const r of PROTECTED.filter((x) => "write" in x && x.write)) {
      const res = await send(app, r, { cookie: admin.cookie });
      expect(res.status, `${r.method.toUpperCase()} ${r.path}`).toBe(403);
      expect(res.body.error).toBe("csrf-check-failed");
    }
  });

  it("refuses a CSRF token that does not match the session", async () => {
    const { app } = await setup();
    const admin = await login(app, "admin@example.test");
    const res = await send(app, { method: "post", path: "/api/v1/tasks", body: {} }, { cookie: admin.cookie, csrf: "wrong-token-value" });
    expect(res.status).toBe(403);
  });
});

describe("role checks on administrator and reviewer routes (Task #15.2)", () => {
  const ADMIN_ONLY = [
    { method: "get", path: "/api/v1/admin/users" },
    { method: "get", path: "/api/v1/activity" },
    { method: "get", path: "/api/v1/admin/settings" },
    { method: "post", path: "/api/v1/admin/allocations/:id/adjust", body: { mode: "set", hours: 1 }, write: true },
    { method: "post", path: "/api/v1/admin/users/:id/reset-token", body: {}, write: true },
  ] as const;

  it("refuses administrator routes to managers and employees", async () => {
    const { app } = await setup();
    for (const who of ["manager@example.test", "emp@example.test"]) {
      const s = await login(app, who);
      for (const r of ADMIN_ONLY) {
        const res = await send(app, r, { cookie: s.cookie, csrf: s.csrf });
        expect(res.status, `${who} ${r.method.toUpperCase()} ${r.path}`).toBe(403);
      }
    }
  });

  it("refuses the review queue and every decision to people who are not the designated reviewer", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    expect((await request(app).get("/api/v1/reviews").set("Cookie", m.cookie)).status).toBe(403);
    const e = await login(app, "emp@example.test");
    expect((await request(app).get("/api/v1/reviews").set("Cookie", e.cookie)).status).toBe(403);
    const decide = await request(app).post("/api/v1/submissions/u-emp/decisions").set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send({ decision: "approve" });
    expect([403, 404]).toContain(decide.status);
  });

  it("refuses task writes to employees, and the directory to employees", async () => {
    const { app } = await setup();
    const e = await login(app, "emp@example.test");
    expect((await request(app).post("/api/v1/tasks").set("Cookie", e.cookie).set("X-CSRF-Token", e.csrf).send({})).status).toBe(403);
    expect((await request(app).get("/api/v1/directory/users").set("Cookie", e.cookie)).status).toBe(403);
  });
});

describe("resource access between people (Task #15.2)", () => {
  it("hides another person's task, its history, reviews, and report rows from an employee", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const task = await request(app).post("/api/v1/tasks").set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf)
      .send({ title: "Private", priority: "Low", assigneeId: "u-emp", reviewerId: "u-reviewer" });
    const id = task.body.id as string;
    const stranger = await login(app, "other@example.test");
    expect((await request(app).get(`/api/v1/tasks/${id}`).set("Cookie", stranger.cookie)).status).toBe(404);
    expect((await request(app).get(`/api/v1/tasks/${id}/history`).set("Cookie", stranger.cookie)).status).toBe(404);
    expect((await request(app).get(`/api/v1/tasks/${id}/reviews`).set("Cookie", stranger.cookie)).status).toBe(404);
    expect((await request(app).post(`/api/v1/tasks/${id}/submissions`).set("Cookie", stranger.cookie).set("X-CSRF-Token", stranger.csrf).send({})).status).toBe(404);
    const report = await request(app).get("/api/v1/reports/history").set("Cookie", stranger.cookie);
    expect(report.body.items.some((i: { taskTitle: string }) => i.taskTitle === "Private")).toBe(false);
    const list = await request(app).get("/api/v1/tasks").set("Cookie", stranger.cookie);
    expect(list.body.items.some((i: { id: string }) => i.id === id)).toBe(false);
  });

  it("hides another person's allocation history and refuses their notifications", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test");
    await request(app).post("/api/v1/admin/allocations/u-emp/adjust").set("Cookie", a.cookie).set("X-CSRF-Token", a.csrf).send({ mode: "set", hours: 5 });
    const stranger = await login(app, "other@example.test");
    expect((await request(app).get("/api/v1/allocations/u-emp/history").set("Cookie", stranger.cookie)).status).toBe(404);
    const inbox = await request(app).get("/api/v1/notifications").set("Cookie", stranger.cookie);
    expect(inbox.body.items).toHaveLength(0);
  });

  it("refuses to change a user's own role or status through the profile route", async () => {
    const { app } = await setup();
    const e = await login(app, "emp@example.test");
    const res = await request(app).patch("/api/v1/me").set("Cookie", e.cookie).set("X-CSRF-Token", e.csrf).send({ roles: ["ADMINISTRATOR"] });
    expect(res.status).toBe(400);
  });
});

describe("input handling (Task #15.2)", () => {
  it("refuses unknown fields on create and edit", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const res = await request(app).post("/api/v1/tasks").set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf)
      .send({ title: "t", priority: "Low", assigneeId: "u-emp", reviewerId: "u-reviewer", isAdmin: true });
    expect(res.status).toBe(400);
  });

  it("refuses an oversized body", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const res = await request(app).post("/api/v1/tasks").set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ title: "x".repeat(40_000), priority: "Low", assigneeId: "u-emp", reviewerId: "u-reviewer" }));
    expect(res.status).toBe(413);
  });

  it("answers malformed JSON with a client error, not a server error", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const res = await request(app).post("/api/v1/tasks").set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf)
      .set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBeLessThan(500);
  });

  it("treats search text as plain text, not as a query", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const res = await request(app).get("/api/v1/tasks?q=' OR 1=1 --").set("Cookie", m.cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it("refuses an unknown route and sends no framework fingerprint", async () => {
    const { app } = await setup();
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("session lifecycle (Task #15.2)", () => {
  it("ends the session at logout, so the old cookie stops working", async () => {
    const { app } = await setup();
    const e = await login(app, "emp@example.test");
    expect((await request(app).get("/api/v1/me").set("Cookie", e.cookie)).status).toBe(200);
    await request(app).post("/api/v1/auth/logout").set("Cookie", e.cookie).set("X-CSRF-Token", e.csrf);
    expect((await request(app).get("/api/v1/me").set("Cookie", e.cookie)).status).toBe(401);
  });

  it("ends a session that has expired", async () => {
    const { app, sessions } = await setup();
    const e = await login(app, "emp@example.test");
    const record = await sessions.find(e.cookie.replace("sid=", ""));
    expect(record).not.toBeNull();
    // Force expiry on the stored session and check the next request is refused.
    (record as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1000);
    expect((await request(app).get("/api/v1/me").set("Cookie", e.cookie)).status).toBe(401);
  });

  it("ends every session of a deactivated user", async () => {
    const { app } = await setup();
    const e = await login(app, "emp@example.test");
    const a = await login(app, "admin@example.test");
    await request(app).patch("/api/v1/admin/users/u-emp").set("Cookie", a.cookie).set("X-CSRF-Token", a.csrf).send({ status: "deactivated" });
    expect((await request(app).get("/api/v1/me").set("Cookie", e.cookie)).status).toBe(401);
  });
});
