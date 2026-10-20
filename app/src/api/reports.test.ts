import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import type { UserRecord, UserStore } from "./auth.js";
import type { UserAdminStore } from "../auth/reset.js";

// Task #13.1 through the API. Visibility matches the task list: managers see all tasks, employees see their own.
const PASSWORD = "report-test-password-1";

async function setup() {
  const hash = await hashPassword(PASSWORD);
  const base = { passwordHash: hash, status: "active" as const, isDesignatedReviewer: false };
  const records: UserRecord[] = [
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

async function makeTask(app: ReturnType<typeof createApp>, m: { cookie: string; csrf: string }, body: object) {
  return request(app).post("/api/v1/tasks").set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf)
    .send({ priority: "Low", reviewerId: "u-reviewer", ...body });
}

describe("task reports API (Task #13.1)", () => {
  it("refuses the report without a session", async () => {
    const app = await setup();
    expect((await request(app).get("/api/v1/reports/tasks")).status).toBe(401);
  });

  it("gives managers every task and employees only their own", async () => {
    const app = await setup();
    const m = await login(app, "manager@example.test");
    await makeTask(app, m, { title: "Mine", assigneeId: "u-emp" });
    await makeTask(app, m, { title: "Theirs", assigneeId: "u-other" });
    const manager = await request(app).get("/api/v1/reports/tasks?groupBy=assignee").set("Cookie", m.cookie);
    expect(manager.body.total).toBe(2);
    expect(manager.body.groups.map((g: { key: string }) => g.key).sort()).toEqual(["u-emp", "u-other"]);

    const e = await login(app, "emp@example.test");
    const employee = await request(app).get("/api/v1/reports/tasks").set("Cookie", e.cookie);
    expect(employee.body.total).toBe(1);
  });

  it("counts overdue open tasks", async () => {
    const app = await setup();
    const m = await login(app, "manager@example.test");
    await makeTask(app, m, { title: "Late", assigneeId: "u-emp", dueDate: "2020-01-01T00:00:00Z" });
    const second = await makeTask(app, m, { title: "Also late", assigneeId: "u-emp", dueDate: "2020-01-02T00:00:00Z" });
    expect(second.status).toBe(201);
    const res = await request(app).get("/api/v1/reports/tasks?groupBy=overdue").set("Cookie", m.cookie);
    expect(res.body.overdue).toBe(2);
    expect(res.body.groups.find((g: { key: string }) => g.key === "overdue").count).toBe(2);
  });

  it("filters by due date range and returns a weekly trend only when a range is given", async () => {
    const app = await setup();
    const m = await login(app, "manager@example.test");
    await makeTask(app, m, { title: "In range", assigneeId: "u-emp", dueDate: "2026-10-14T00:00:00Z" });
    await makeTask(app, m, { title: "Out of range", assigneeId: "u-emp", dueDate: "2026-11-30T00:00:00Z" });
    const ranged = await request(app).get("/api/v1/reports/tasks?dateField=dueDate&from=2026-10-01&to=2026-10-31").set("Cookie", m.cookie);
    expect(ranged.body.total).toBe(1);
    expect(ranged.body.trend.find((w: { week: string }) => w.week === "2026-10-12").due).toBe(1);
    const unranged = await request(app).get("/api/v1/reports/tasks").set("Cookie", m.cookie);
    expect(unranged.body.trend).toBeNull();
  });

  it("refuses malformed or inverted ranges", async () => {
    const app = await setup();
    const m = await login(app, "manager@example.test");
    expect((await request(app).get("/api/v1/reports/tasks?from=2026-10-31&to=2026-10-01").set("Cookie", m.cookie)).body.error).toBe("invalid-range");
    expect((await request(app).get("/api/v1/reports/tasks?from=yesterday").set("Cookie", m.cookie)).body.error).toBe("invalid-range");
    expect((await request(app).get("/api/v1/reports/tasks?groupBy=colour").set("Cookie", m.cookie)).status).toBe(400);
  });
});
