import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import { InMemoryAuditStore } from "../audit/audit.js";
import type { UserRecord, UserStore } from "./auth.js";
import type { UserAdminStore } from "../auth/reset.js";

const PASSWORD = "activity-test-password-1";

async function setup() {
  const hash = await hashPassword(PASSWORD);
  const base = { passwordHash: hash, status: "active" as const, isDesignatedReviewer: false };
  const records: UserRecord[] = [
    { ...base, id: "u-admin", email: "admin@example.test", roles: ["ADMINISTRATOR"] },
    { ...base, id: "u-manager", email: "manager@example.test", roles: ["MANAGER"] },
    { ...base, id: "u-reviewer", email: "reviewer@example.test", roles: ["MANAGER"], isDesignatedReviewer: true },
    { ...base, id: "u-employee", email: "employee@example.test", roles: ["EMPLOYEE"] },
    { ...base, id: "u-other", email: "other@example.test", roles: ["EMPLOYEE"] },
  ];
  const users: UserStore = { findByEmail: async (e) => records.find((r) => r.email === e) ?? null };
  const userAdmin: UserAdminStore = {
    findById: async (id) => {
      const r = records.find((x) => x.id === id);
      return r ? { id: r.id, roles: r.roles, isDesignatedReviewer: r.isDesignatedReviewer } : null;
    },
    setPasswordHash: async () => undefined,
    getPasswordHash: async (id) => records.find((x) => x.id === id)?.passwordHash ?? null,
  };
  const seed: UserView[] = records.map((r) => ({
    id: r.id, name: r.id, email: r.email, roles: r.roles, status: r.status, isDesignatedReviewer: r.isDesignatedReviewer,
  }));
  const audit = new InMemoryAuditStore();
  const app = createApp({ users, sessions: new InMemorySessionStore(), userAdmin, userDirectory: new InMemoryUserDirectory(seed), audit });
  return { app, audit };
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
  return { cookie, csrf: res.body.csrfToken as string };
}

describe("activity log (Task #9.2)", () => {
  it("refuses the activity log to managers, employees, and anonymous callers", async () => {
    const { app } = await setup();
    expect((await request(app).get("/api/v1/activity")).status).toBe(401);
    for (const email of ["manager@example.test", "employee@example.test"]) {
      const s = await login(app, email);
      expect((await request(app).get("/api/v1/activity").set("Cookie", s.cookie)).status).toBe(403);
    }
  });

  it("lists records newest first, with actor names, and filters by action", async () => {
    const { app, audit } = await setup();
    const a = await login(app, "admin@example.test");
    const m = await login(app, "manager@example.test");
    await request(app).post("/api/v1/tasks").set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf)
      .send({ title: "Logged", priority: "Low", assigneeId: "u-employee", reviewerId: "u-reviewer" });
    await request(app).post("/api/v1/admin/allocations/u-other/adjust").set("Cookie", a.cookie).set("X-CSRF-Token", a.csrf)
      .send({ mode: "set", hours: 6, reason: "Q4" });
    expect(audit.list().length).toBeGreaterThan(1);

    const all = await request(app).get("/api/v1/activity").set("Cookie", a.cookie);
    expect(all.status).toBe(200);
    expect(all.body.items[0].at >= all.body.items[all.body.items.length - 1].at).toBe(true);
    expect(all.body.items.find((i: { action: string }) => i.action === "task.created").actorName).toBe("u-manager");

    const filtered = await request(app).get("/api/v1/activity?action=allocation.adjusted").set("Cookie", a.cookie);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items[0].payload).toMatchObject({ newHours: 6, reason: "Q4" });
  });

  it("pages the log and rejects an oversized page", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test");
    const m = await login(app, "manager@example.test");
    for (let i = 0; i < 3; i++) {
      await request(app).post("/api/v1/tasks").set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf)
        .send({ title: `T${i}`, priority: "Low", assigneeId: "u-employee", reviewerId: "u-reviewer" });
    }
    const page = await request(app).get("/api/v1/activity?pageSize=2&page=2&action=task.created").set("Cookie", a.cookie);
    expect(page.body.total).toBe(3);
    expect(page.body.items).toHaveLength(1);
    expect((await request(app).get("/api/v1/activity?pageSize=500").set("Cookie", a.cookie)).status).toBe(400);
  });
});

describe("task history (Task #9.2, scoped)", () => {
  it("shows status history to managers and to the assignee, and hides it from anyone else", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const created = await request(app).post("/api/v1/tasks").set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf)
      .send({ title: "Tracked", priority: "Low", assigneeId: "u-employee", reviewerId: "u-reviewer" });
    const id = created.body.id as string;
    await request(app).post(`/api/v1/tasks/${id}/status`).set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send({ status: "In Progress" });

    const mine = await request(app).get(`/api/v1/tasks/${id}/history`).set("Cookie", m.cookie);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ fromStatus: "To Do", toStatus: "In Progress", actorName: "u-manager" });

    const assignee = await login(app, "employee@example.test");
    expect((await request(app).get(`/api/v1/tasks/${id}/history`).set("Cookie", assignee.cookie)).status).toBe(200);

    const stranger = await login(app, "other@example.test");
    expect((await request(app).get(`/api/v1/tasks/${id}/history`).set("Cookie", stranger.cookie)).status).toBe(404);
  });
});
