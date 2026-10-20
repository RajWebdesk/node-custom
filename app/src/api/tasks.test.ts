import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import { InMemoryTaskStore, StaleStatusError } from "../tasks/task-store.js";
import type { UserRecord, UserStore } from "./auth.js";
import type { UserAdminStore } from "../auth/reset.js";

const PASSWORD = "task-test-password-1";

async function setup() {
  const hash = await hashPassword(PASSWORD);
  const base = { passwordHash: hash, status: "active" as const };
  const records: UserRecord[] = [
    { ...base, id: "u-admin", email: "admin@example.test", roles: ["ADMINISTRATOR"], isDesignatedReviewer: false },
    { ...base, id: "u-manager", email: "manager@example.test", roles: ["MANAGER"], isDesignatedReviewer: false },
    { ...base, id: "u-reviewer", email: "reviewer@example.test", roles: ["MANAGER"], isDesignatedReviewer: true },
    { ...base, id: "u-employee", email: "employee@example.test", roles: ["EMPLOYEE"], isDesignatedReviewer: false },
    { ...base, id: "u-other", email: "other@example.test", roles: ["EMPLOYEE"], isDesignatedReviewer: false },
    { ...base, id: "u-gone", email: "gone@example.test", roles: ["EMPLOYEE"], isDesignatedReviewer: false, status: "deactivated" },
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
    id: r.id,
    name: r.id,
    email: r.email,
    roles: r.roles,
    status: r.status,
    isDesignatedReviewer: r.isDesignatedReviewer,
  }));
  const taskStore = new InMemoryTaskStore();
  const app = createApp({
    users,
    sessions: new InMemorySessionStore(),
    userAdmin,
    userDirectory: new InMemoryUserDirectory(seed),
    taskStore,
  });
  return { app, taskStore };
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
  return { cookie, csrf: res.body.csrfToken as string };
}

function validTask(overrides: Record<string, unknown> = {}) {
  return {
    title: "Write the report",
    priority: "Medium",
    assigneeId: "u-employee",
    reviewerId: "u-reviewer",
    ...overrides,
  };
}

async function createAs(app: ReturnType<typeof createApp>, s: { cookie: string; csrf: string }, body: object) {
  return request(app).post("/api/v1/tasks").set("Cookie", s.cookie).set("X-CSRF-Token", s.csrf).send(body);
}

describe("task API: access (Task #6.2)", () => {
  it("refuses the task list without a session", async () => {
    const { app } = await setup();
    expect((await request(app).get("/api/v1/tasks")).status).toBe(401);
  });

  it("lets an employee see only tasks assigned to them", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    await createAs(app, m, validTask({ title: "Mine" }));
    await createAs(app, m, validTask({ title: "Theirs", assigneeId: "u-other" }));
    const e = await login(app, "employee@example.test");
    const res = await request(app).get("/api/v1/tasks").set("Cookie", e.cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].title).toBe("Mine");
  });

  it("returns not-found for an employee opening a task assigned to someone else", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const created = await createAs(app, m, validTask({ assigneeId: "u-other" }));
    const e = await login(app, "employee@example.test");
    const res = await request(app).get(`/api/v1/tasks/${created.body.id}`).set("Cookie", e.cookie);
    expect(res.status).toBe(404);
  });

  it("refuses task creation and edits by an employee", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const created = await createAs(app, m, validTask());
    const e = await login(app, "employee@example.test");
    const create = await createAs(app, e, validTask());
    expect(create.status).toBe(403);
    const edit = await request(app)
      .patch(`/api/v1/tasks/${created.body.id}`)
      .set("Cookie", e.cookie)
      .set("X-CSRF-Token", e.csrf)
      .send({ title: "Changed" });
    expect(edit.status).toBe(403);
  });

  it("requires the CSRF token for writes", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const res = await request(app).post("/api/v1/tasks").set("Cookie", m.cookie).send(validTask());
    expect(res.status).toBe(403);
  });
});

describe("task API: create and edit (Task #6.1)", () => {
  it("creates a task in To Do, owned by the creator as PM", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const res = await createAs(app, m, validTask({ startDate: "2026-11-01T09:00:00Z", dueDate: "2026-11-05T17:00:00Z" }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "To Do", pmId: "u-manager", assigneeId: "u-employee", reviewerId: "u-reviewer" });
  });

  it("rejects an inactive assignee, a non-reviewer, reversed dates, and unknown fields", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    expect((await createAs(app, m, validTask({ assigneeId: "u-gone" }))).body.error).toBe("invalid-assignee");
    expect((await createAs(app, m, validTask({ reviewerId: "u-manager" }))).body.error).toBe("invalid-reviewer");
    const reversed = await createAs(app, m, validTask({ startDate: "2026-11-05T00:00:00Z", dueDate: "2026-11-01T00:00:00Z" }));
    expect(reversed.body.error).toBe("invalid-dates");
    const extra = await createAs(app, m, validTask({ status: "Approved" }));
    expect(extra.status).toBe(400);
  });

  it("refuses an edit with a reviewer change, an empty patch, or a missing task", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const created = await createAs(app, m, validTask());
    const patch = (body: object) =>
      request(app).patch(`/api/v1/tasks/${created.body.id}`).set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send(body);
    expect((await patch({ reviewerId: "u-reviewer" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    const missing = await request(app)
      .patch("/api/v1/tasks/nope")
      .set("Cookie", m.cookie)
      .set("X-CSRF-Token", m.csrf)
      .send({ title: "x" });
    expect(missing.status).toBe(404);
    const ok = await patch({ title: "Renamed", priority: "High" });
    expect(ok.body).toMatchObject({ title: "Renamed", priority: "High" });
  });
});

describe("task API: status moves and workflow (Task #6.3)", () => {
  it("moves a task between free statuses and writes history", async () => {
    const { app, taskStore } = await setup();
    const m = await login(app, "manager@example.test");
    const created = await createAs(app, m, validTask());
    const res = await request(app)
      .post(`/api/v1/tasks/${created.body.id}/status`)
      .set("Cookie", m.cookie)
      .set("X-CSRF-Token", m.csrf)
      .send({ status: "In Progress" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("In Progress");
    expect(taskStore.history).toHaveLength(1);
    expect(taskStore.history[0]).toMatchObject({ fromStatus: "To Do", toStatus: "In Progress", actorId: "u-manager" });
  });

  it("keeps approval-controlled statuses out of plain moves, in both directions", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const created = await createAs(app, m, validTask());
    const move = (status: string) =>
      request(app).post(`/api/v1/tasks/${created.body.id}/status`).set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send({ status });
    expect((await move("In Review")).body.error).toBe("workflow-controlled");
    expect((await move("Approved")).body.error).toBe("workflow-controlled");
    expect((await move("Revision requested")).body.error).toBe("workflow-controlled");
  });

  it("refuses a move to the same status and an unknown status", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const created = await createAs(app, m, validTask());
    const move = (status: string) =>
      request(app).post(`/api/v1/tasks/${created.body.id}/status`).set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send({ status });
    expect((await move("To Do")).body.error).toBe("same-status");
    expect((await move("Shipped")).status).toBe(400);
  });

  it("refuses a status move by an employee, even on their own task", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const created = await createAs(app, m, validTask());
    const e = await login(app, "employee@example.test");
    const res = await request(app)
      .post(`/api/v1/tasks/${created.body.id}/status`)
      .set("Cookie", e.cookie)
      .set("X-CSRF-Token", e.csrf)
      .send({ status: "In Progress" });
    expect(res.status).toBe(403);
  });

  it("rejects a stale status change (another change moved the task first)", async () => {
    const store = new InMemoryTaskStore();
    const row = await store.create({
      title: "t", description: null, priority: "Low", status: "To Do", assigneeId: "a", pmId: "p", reviewerId: "r",
      startDate: null, dueDate: null,
    });
    await expect(store.moveStatus({ taskId: row.id, fromStatus: "In Progress", toStatus: "To Do", actorId: "p" })).rejects.toBeInstanceOf(StaleStatusError);
    expect(store.history).toHaveLength(0);
  });
});

describe("task API: archival and list queries (Task #6.1, #6.2)", () => {
  it("archives a task, hides it from the default list, and blocks edits and moves until unarchived", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const created = await createAs(app, m, validTask({ title: "Old" }));
    const id = created.body.id;
    const archive = await request(app).patch(`/api/v1/tasks/${id}`).set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send({ archived: true });
    expect(archive.status).toBe(200);
    expect(archive.body.archivedAt).not.toBeNull();

    const active = await request(app).get("/api/v1/tasks").set("Cookie", m.cookie);
    expect(active.body.total).toBe(0);
    const archived = await request(app).get("/api/v1/tasks?archived=true").set("Cookie", m.cookie);
    expect(archived.body.total).toBe(1);

    const edit = await request(app).patch(`/api/v1/tasks/${id}`).set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send({ title: "x" });
    expect(edit.body.error).toBe("archived");
    const move = await request(app).post(`/api/v1/tasks/${id}/status`).set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send({ status: "In Progress" });
    expect(move.body.error).toBe("archived");

    const restore = await request(app).patch(`/api/v1/tasks/${id}`).set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send({ archived: false });
    expect(restore.status).toBe(200);
    expect(restore.body.archivedAt).toBeNull();
  });

  it("filters, sorts, and pages the list", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    await createAs(app, m, validTask({ title: "Charlie", priority: "Low" }));
    await createAs(app, m, validTask({ title: "Alpha", priority: "High" }));
    await createAs(app, m, validTask({ title: "Bravo", priority: "High" }));
    const page = await request(app).get("/api/v1/tasks?sortBy=title&sortDir=asc&pageSize=2&page=1").set("Cookie", m.cookie);
    expect(page.body.total).toBe(3);
    expect(page.body.items.map((t: { title: string }) => t.title)).toEqual(["Alpha", "Bravo"]);
    const high = await request(app).get("/api/v1/tasks?priority=High").set("Cookie", m.cookie);
    expect(high.body.total).toBe(2);
    const bad = await request(app).get("/api/v1/tasks?pageSize=500").set("Cookie", m.cookie);
    expect(bad.status).toBe(400);
  });
});

describe("task API: search and assignable users (Task #7.1, #7.2)", () => {
  it("searches titles case-insensitively, within the caller's visible tasks", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    await createAs(app, m, validTask({ title: "Quarterly Report" }));
    await createAs(app, m, validTask({ title: "Invoice batch", assigneeId: "u-other" }));
    const hit = await request(app).get("/api/v1/tasks?q=quarterly").set("Cookie", m.cookie);
    expect(hit.body.total).toBe(1);
    expect(hit.body.items[0].title).toBe("Quarterly Report");
    const e = await login(app, "employee@example.test");
    const none = await request(app).get("/api/v1/tasks?q=invoice").set("Cookie", e.cookie);
    expect(none.body.total).toBe(0);
  });

  it("lists active users for managers, and refuses employees", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test");
    const res = await request(app).get("/api/v1/directory/users").set("Cookie", m.cookie);
    expect(res.status).toBe(200);
    const ids = res.body.users.map((u: { id: string }) => u.id);
    expect(ids).toContain("u-reviewer");
    expect(ids).not.toContain("u-gone");
    expect(JSON.stringify(res.body)).not.toContain("email");
    const e = await login(app, "employee@example.test");
    expect((await request(app).get("/api/v1/directory/users").set("Cookie", e.cookie)).status).toBe(403);
  });
});
