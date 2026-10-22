import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import { InMemoryTaskStore } from "../tasks/task-store.js";
import { countUsage, InMemoryTaskListStore } from "../tasks/task-list-store.js";
import type { UserRecord, UserStore } from "./auth.js";
import type { UserAdminStore } from "../auth/reset.js";

// Task #13.3: configurable status and priority lists, with protected workflow statuses.
const PASSWORD = "task-list-password-1";

async function setup() {
  const hash = await hashPassword(PASSWORD);
  const base = { passwordHash: hash, status: "active" as const };
  const records: UserRecord[] = [
    { ...base, id: "u-admin", email: "admin@example.test", roles: ["ADMINISTRATOR"], isDesignatedReviewer: false },
    { ...base, id: "u-manager", email: "manager@example.test", roles: ["MANAGER"], isDesignatedReviewer: false },
    { ...base, id: "u-reviewer", email: "reviewer@example.test", roles: ["MANAGER"], isDesignatedReviewer: true },
    { ...base, id: "u-employee", email: "employee@example.test", roles: ["EMPLOYEE"], isDesignatedReviewer: false },
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
  const seed: UserView[] = records.map((r) => ({ id: r.id, name: r.id, email: r.email, roles: r.roles, status: r.status, isDesignatedReviewer: r.isDesignatedReviewer }));
  const taskStore = new InMemoryTaskStore();
  const app = createApp({
    users,
    sessions: new InMemorySessionStore(),
    userAdmin,
    userDirectory: new InMemoryUserDirectory(seed),
    taskStore,
    taskLists: new InMemoryTaskListStore(undefined, async () => countUsage(taskStore.all())),
  });
  return { app };
}

async function login(app: App, email: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
  return { cookie, csrf: res.body.csrfToken as string };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

const put = (app: App, s: { cookie: string; csrf: string }, body: object) =>
  request(app).put("/api/v1/admin/task-lists").set("Cookie", s.cookie).set("X-CSRF-Token", s.csrf).send(body);

async function newTask(app: App, manager: { cookie: string; csrf: string }, priority: string) {
  return request(app).post("/api/v1/tasks").set("Cookie", manager.cookie).set("X-CSRF-Token", manager.csrf)
    .send({ title: "Configured task", priority, assigneeId: "u-employee", reviewerId: "u-reviewer" });
}

async function moveTo(app: App, manager: { cookie: string; csrf: string }, taskId: string, status: string) {
  return request(app).post(`/api/v1/tasks/${taskId}/status`).set("Cookie", manager.cookie).set("X-CSRF-Token", manager.csrf).send({ status });
}

describe("task lists API (Task #13.3)", () => {
  it("shows the built-in statuses as protected to signed-in users", async () => {
    const { app } = await setup();
    const s = await login(app, "employee@example.test");
    const res = await request(app).get("/api/v1/task-lists").set("Cookie", s.cookie);
    expect(res.status).toBe(200);
    expect(res.body.statuses.filter((x: { protected: boolean }) => x.protected).map((x: { value: string }) => x.value)).toEqual([
      "To Do",
      "In Progress",
      "In Review",
      "Approved",
      "Revision requested",
    ]);
    expect(res.body.priorities).toEqual(["Low", "Medium", "High"]);
  });

  it("refuses the list without a session, changes from a manager, and changes without the CSRF token", async () => {
    const { app } = await setup();
    expect((await request(app).get("/api/v1/task-lists")).status).toBe(401);
    const manager = await login(app, "manager@example.test");
    expect((await put(app, manager, { statuses: [], priorities: ["Low"] })).status).toBe(403);
    const admin = await login(app, "admin@example.test");
    const noCsrf = await request(app).put("/api/v1/admin/task-lists").set("Cookie", admin.cookie).send({ statuses: [], priorities: ["Low"] });
    expect(noCsrf.status).toBe(403);
  });

  it("refuses to add a built-in status as an extra", async () => {
    const { app } = await setup();
    const admin = await login(app, "admin@example.test");
    const res = await put(app, admin, { statuses: ["Approved"], priorities: ["Low"] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "protected-status", value: "Approved" });
  });

  it("lets an administrator add a status and a priority, and then managers use them", async () => {
    const { app } = await setup();
    const admin = await login(app, "admin@example.test");
    expect((await put(app, admin, { statuses: ["Waiting"], priorities: ["Low", "Medium", "High", "Urgent"] })).status).toBe(200);
    const manager = await login(app, "manager@example.test");
    const created = await newTask(app, manager, "Urgent");
    expect(created.status).toBe(201);
    expect((await moveTo(app, manager, created.body.id, "Waiting")).status).toBe(200);
  });

  it("refuses a task priority that is not in the list", async () => {
    const { app } = await setup();
    const manager = await login(app, "manager@example.test");
    const res = await newTask(app, manager, "Urgent");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid-priority");
  });

  it("keeps workflow-controlled statuses out of plain moves", async () => {
    const { app } = await setup();
    const admin = await login(app, "admin@example.test");
    await put(app, admin, { statuses: ["Waiting"], priorities: ["Low", "Medium", "High"] });
    const manager = await login(app, "manager@example.test");
    const created = await newTask(app, manager, "Low");
    const move = await moveTo(app, manager, created.body.id, "Approved");
    expect(move.status).toBe(409);
    expect(move.body.error).toBe("workflow-controlled");
  });

  it("refuses to remove a status or priority that a task still uses", async () => {
    const { app } = await setup();
    const admin = await login(app, "admin@example.test");
    await put(app, admin, { statuses: ["Waiting"], priorities: ["Low", "Medium", "High"] });
    const manager = await login(app, "manager@example.test");
    const created = await newTask(app, manager, "Low");
    await moveTo(app, manager, created.body.id, "Waiting");
    const res = await put(app, admin, { statuses: [], priorities: ["Low", "Medium", "High"] });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "in-use", value: "Waiting", kind: "status" });
  });

  it("lets an employee submit a task from a configured free status", async () => {
    const { app } = await setup();
    const admin = await login(app, "admin@example.test");
    await put(app, admin, { statuses: ["Waiting"], priorities: ["Low", "Medium", "High"] });
    const manager = await login(app, "manager@example.test");
    const created = await newTask(app, manager, "Low");
    await moveTo(app, manager, created.body.id, "Waiting");
    const employee = await login(app, "employee@example.test");
    const submit = await request(app).post(`/api/v1/tasks/${created.body.id}/submissions`).set("Cookie", employee.cookie).set("X-CSRF-Token", employee.csrf).send({});
    expect(submit.status).toBe(201);
  });
});
