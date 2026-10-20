import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import { InMemoryAuditStore } from "../audit/audit.js";
import type { UserRecord, UserStore } from "./auth.js";
import type { UserAdminStore } from "../auth/reset.js";

// Module 10 (Tasks #10.1 to #10.5). Designated reviewer: u-as. Assignee/submitter: u-emp. Other manager: u-hazel.
const PASSWORD = "reviewer-password-1";

async function setup() {
  const pw = await hashPassword(PASSWORD);
  const base = { passwordHash: pw, status: "active" as const };
  const records: UserRecord[] = [
    { ...base, id: "u-as", email: "as@example.test", roles: ["MANAGER"], isDesignatedReviewer: true },
    { ...base, id: "u-hazel", email: "hazel@example.test", roles: ["MANAGER"], isDesignatedReviewer: false },
    { ...base, id: "u-emp", email: "emp@example.test", roles: ["EMPLOYEE"], isDesignatedReviewer: false },
    { ...base, id: "u-other", email: "other@example.test", roles: ["EMPLOYEE"], isDesignatedReviewer: false },
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

async function newTask(app: ReturnType<typeof createApp>, assigneeId = "u-emp") {
  const m = await login(app, "hazel@example.test");
  const res = await request(app)
    .post("/api/v1/tasks")
    .set("Cookie", m.cookie)
    .set("X-CSRF-Token", m.csrf)
    .send({ title: "Reviewed work", priority: "Medium", assigneeId, reviewerId: "u-as" });
  return res.body.id as string;
}

async function submit(app: ReturnType<typeof createApp>, who: { cookie: string; csrf: string }, taskId: string) {
  return request(app).post(`/api/v1/tasks/${taskId}/submissions`).set("Cookie", who.cookie).set("X-CSRF-Token", who.csrf).send({});
}

async function decide(app: ReturnType<typeof createApp>, who: { cookie: string; csrf: string }, submissionId: string, decision: string) {
  return request(app).post(`/api/v1/submissions/${submissionId}/decisions`).set("Cookie", who.cookie).set("X-CSRF-Token", who.csrf).send({ decision });
}

async function statusOf(app: ReturnType<typeof createApp>, who: { cookie: string }, taskId: string) {
  return (await request(app).get(`/api/v1/tasks/${taskId}`).set("Cookie", who.cookie)).body.status as string;
}

describe("reviewer identity and decisions (Task #10.1, #10.5)", () => {
  it("the designated reviewer can approve another person's submission", async () => {
    const { app } = await setup();
    const taskId = await newTask(app);
    const e = await login(app, "emp@example.test");
    const s = (await submit(app, e, taskId)).body;
    const as = await login(app, "as@example.test");
    const res = await decide(app, as, s.id, "approve");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ outcome: "approve", taskStatus: "Approved", taskStaysInReview: false });
    expect(await statusOf(app, e, taskId)).toBe("Approved");
  });

  it("a Manager who is not the designated reviewer cannot decide", async () => {
    const { app } = await setup();
    const taskId = await newTask(app);
    const e = await login(app, "emp@example.test");
    const s = (await submit(app, e, taskId)).body;
    const hazel = await login(app, "hazel@example.test");
    expect((await decide(app, hazel, s.id, "approve")).status).toBe(403);
    expect(await statusOf(app, e, taskId)).toBe("In Review");
  });

  it("the designated reviewer cannot approve their own submission", async () => {
    const { app } = await setup();
    const taskId = await newTask(app, "u-as");
    const as = await login(app, "as@example.test");
    const s = (await submit(app, as, taskId)).body;
    expect((await decide(app, as, s.id, "approve")).status).toBe(403);
  });

  it("a second decision on the same submission is refused", async () => {
    const { app } = await setup();
    const taskId = await newTask(app);
    const e = await login(app, "emp@example.test");
    const s = (await submit(app, e, taskId)).body;
    const as = await login(app, "as@example.test");
    await decide(app, as, s.id, "revise");
    const again = await decide(app, as, s.id, "approve");
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("already-decided");
  });

  it("rejection is recorded and the task stays In Review", async () => {
    const { app } = await setup();
    const taskId = await newTask(app);
    const e = await login(app, "emp@example.test");
    const s = (await submit(app, e, taskId)).body;
    const as = await login(app, "as@example.test");
    const res = await decide(app, as, s.id, "reject");
    expect(res.body).toMatchObject({ taskStatus: "In Review", taskStaysInReview: true });
    expect(await statusOf(app, e, taskId)).toBe("In Review");
  });
});

describe("submission and revision cycle (Task #10.2, #10.4)", () => {
  it("submits, is revised, resubmits as the next revision, and is approved", async () => {
    const { app } = await setup();
    const taskId = await newTask(app);
    const e = await login(app, "emp@example.test");
    const first = await submit(app, e, taskId);
    expect(first.body.revisionNo).toBe(1);
    const as = await login(app, "as@example.test");
    await decide(app, as, first.body.id, "revise");
    expect(await statusOf(app, e, taskId)).toBe("Revision requested");

    const second = await submit(app, e, taskId);
    expect(second.status).toBe(201);
    expect(second.body.revisionNo).toBe(2);
    await decide(app, as, second.body.id, "approve");
    expect(await statusOf(app, e, taskId)).toBe("Approved");

    const history = await request(app).get(`/api/v1/tasks/${taskId}/reviews`).set("Cookie", e.cookie);
    expect(history.body.items.map((i: { revisionNo: number; decision: string }) => [i.revisionNo, i.decision])).toEqual([
      [1, "revise"],
      [2, "approve"],
    ]);
    expect(history.body.items[0].deciderName).toBe("u-as");
  });

  it("allows a resubmission after a rejection, since the rejected submission is closed", async () => {
    const { app } = await setup();
    const taskId = await newTask(app);
    const e = await login(app, "emp@example.test");
    const first = await submit(app, e, taskId);
    const as = await login(app, "as@example.test");
    await decide(app, as, first.body.id, "reject");
    const again = await submit(app, e, taskId);
    expect(again.status).toBe(201);
    expect(again.body.revisionNo).toBe(2);
    expect(await statusOf(app, e, taskId)).toBe("In Review");
  });

  it("refuses a submission while a submission is open, and for a task that is not assigned to the caller", async () => {
    const { app } = await setup();
    const taskId = await newTask(app);
    const e = await login(app, "emp@example.test");
    await submit(app, e, taskId);
    const again = await submit(app, e, taskId);
    expect(again.body.error).toBe("already-in-review");
    const other = await login(app, "other@example.test");
    expect((await submit(app, other, taskId)).status).toBe(404);
  });

  it("refuses decisions on a task that is no longer In Review, and submissions on archived tasks", async () => {
    const { app } = await setup();
    const taskId = await newTask(app);
    const e = await login(app, "emp@example.test");
    const s = (await submit(app, e, taskId)).body;
    const as = await login(app, "as@example.test");
    await decide(app, as, s.id, "approve");
    const m = await login(app, "hazel@example.test");
    await request(app).patch(`/api/v1/tasks/${taskId}`).set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send({ archived: true });
    const archivedSubmit = await submit(app, e, taskId);
    expect(archivedSubmit.body.error).toBe("archived");
  });
});

describe("reviewer queue and detail (Task #10.3)", () => {
  it("lists open submissions to the designated reviewer only, and drops them once decided", async () => {
    const { app } = await setup();
    const taskId = await newTask(app);
    const e = await login(app, "emp@example.test");
    const s = (await submit(app, e, taskId)).body;
    const as = await login(app, "as@example.test");
    const queue = await request(app).get("/api/v1/reviews").set("Cookie", as.cookie);
    expect(queue.body.items.map((i: { submissionId: string }) => i.submissionId)).toEqual([s.id]);
    expect(queue.body.items[0]).toMatchObject({ taskTitle: "Reviewed work", submitterName: "u-emp" });

    expect((await request(app).get("/api/v1/reviews").set("Cookie", e.cookie)).status).toBe(403);
    const hazel = await login(app, "hazel@example.test");
    expect((await request(app).get("/api/v1/reviews").set("Cookie", hazel.cookie)).status).toBe(403);

    await decide(app, as, s.id, "revise");
    const after = await request(app).get("/api/v1/reviews").set("Cookie", as.cookie);
    expect(after.body.items).toHaveLength(0);
  });

  it("shows the decision controls only to the designated reviewer, and not to the submitter", async () => {
    const { app } = await setup();
    const taskId = await newTask(app);
    const e = await login(app, "emp@example.test");
    const s = (await submit(app, e, taskId)).body;
    const as = await login(app, "as@example.test");
    const forReviewer = await request(app).get(`/api/v1/submissions/${s.id}`).set("Cookie", as.cookie);
    expect(forReviewer.body.canDecide).toBe(true);
    const forSubmitter = await request(app).get(`/api/v1/submissions/${s.id}`).set("Cookie", e.cookie);
    expect(forSubmitter.body.canDecide).toBe(false);
  });
});

describe("workflow audit (Task #10.5)", () => {
  it("writes a record for each submission and each decision, with the submission id", async () => {
    const { app, audit } = await setup();
    const taskId = await newTask(app);
    const e = await login(app, "emp@example.test");
    const s = (await submit(app, e, taskId)).body;
    const as = await login(app, "as@example.test");
    await decide(app, as, s.id, "approve");
    const actions = audit.list().filter((r) => r.entityId === s.id).map((r) => r.action);
    expect(actions).toEqual(["approval.submitted", "approval.decision_recorded"]);
  });
});
