import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import type { UserRecord, UserStore } from "./auth.js";
import type { UserAdminStore } from "../auth/reset.js";

// Task #13.2: time and change-history reports, through the API.
const PASSWORD = "history-report-password-1";

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
  return createApp({ users, sessions: new InMemorySessionStore(), userAdmin, userDirectory: new InMemoryUserDirectory(seed) });
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
  return { cookie, csrf: res.body.csrfToken as string };
}

describe("time report (Task #13.2)", () => {
  it("summarises planned-time changes per person, and shows an employee only their own", async () => {
    const app = await setup();
    const a = await login(app, "admin@example.test");
    await request(app).post("/api/v1/admin/allocations/u-emp/adjust").set("Cookie", a.cookie).set("X-CSRF-Token", a.csrf).send({ mode: "set", hours: 8, reason: "Plan" });
    await request(app).post("/api/v1/admin/allocations/u-emp/adjust").set("Cookie", a.cookie).set("X-CSRF-Token", a.csrf).send({ mode: "decrease", hours: 3 });
    await request(app).post("/api/v1/admin/allocations/u-other/adjust").set("Cookie", a.cookie).set("X-CSRF-Token", a.csrf).send({ mode: "set", hours: 2 });

    const admin = await request(app).get("/api/v1/reports/time").set("Cookie", a.cookie);
    expect(admin.status).toBe(200);
    const emp = admin.body.totals.find((t: { subjectId: string }) => t.subjectId === "u-emp");
    expect(emp).toMatchObject({ changes: 2, netDelta: 5 });
    expect(admin.body.changes).toHaveLength(3);

    const e = await login(app, "emp@example.test");
    const own = await request(app).get("/api/v1/reports/time").set("Cookie", e.cookie);
    expect(own.body.changes.every((c: { subjectId: string }) => c.subjectId === "u-emp")).toBe(true);
  });

  it("applies the date range and refuses a bad one", async () => {
    const app = await setup();
    const a = await login(app, "admin@example.test");
    await request(app).post("/api/v1/admin/allocations/u-emp/adjust").set("Cookie", a.cookie).set("X-CSRF-Token", a.csrf).send({ mode: "set", hours: 4 });
    const past = await request(app).get("/api/v1/reports/time?from=2020-01-01&to=2020-01-31").set("Cookie", a.cookie);
    expect(past.body.changes).toHaveLength(0);
    expect((await request(app).get("/api/v1/reports/time?from=2026-10-31&to=2026-10-01").set("Cookie", a.cookie)).status).toBe(400);
  });
});

describe("change history report (Task #13.2)", () => {
  it("lists task status changes for tasks the caller can see", async () => {
    const app = await setup();
    const m = await login(app, "manager@example.test");
    const created = await request(app).post("/api/v1/tasks").set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf)
      .send({ title: "Tracked change", priority: "Low", assigneeId: "u-emp", reviewerId: "u-reviewer" });
    await request(app).post(`/api/v1/tasks/${created.body.id}/status`).set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send({ status: "In Progress" });

    const res = await request(app).get("/api/v1/reports/history").set("Cookie", m.cookie);
    expect(res.status).toBe(200);
    const row = res.body.items.find((i: { taskTitle: string }) => i.taskTitle === "Tracked change");
    expect(row).toMatchObject({ fromStatus: "To Do", toStatus: "In Progress", actorName: "u-manager" });

    const assignee = await login(app, "emp@example.test");
    const mine = await request(app).get("/api/v1/reports/history").set("Cookie", assignee.cookie);
    expect(mine.body.items.some((i: { taskTitle: string }) => i.taskTitle === "Tracked change")).toBe(true);
    const stranger = await login(app, "other@example.test");
    const theirs = await request(app).get("/api/v1/reports/history").set("Cookie", stranger.cookie);
    expect(theirs.body.items.some((i: { taskTitle: string }) => i.taskTitle === "Tracked change")).toBe(false);
  });

  it("refuses the reports without a session", async () => {
    const app = await setup();
    expect((await request(app).get("/api/v1/reports/time")).status).toBe(401);
    expect((await request(app).get("/api/v1/reports/history")).status).toBe(401);
  });
});
