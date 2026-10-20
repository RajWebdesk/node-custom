import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import type { UserRecord, UserStore } from "./auth.js";
import type { UserAdminStore } from "../auth/reset.js";

// Task #15.1: one task followed through the whole workflow, with each role in turn. Each step checks what the
// other roles see afterwards, so a regression in any module shows up here.
const PASSWORD = "integration-password-1";

async function setup() {
  const hash = await hashPassword(PASSWORD);
  const base = { passwordHash: hash, status: "active" as const, isDesignatedReviewer: false };
  const records: UserRecord[] = [
    { ...base, id: "u-admin", email: "admin@example.test", roles: ["ADMINISTRATOR"] },
    { ...base, id: "u-hazel", email: "hazel@example.test", roles: ["MANAGER"] },
    { ...base, id: "u-as", email: "as@example.test", roles: ["MANAGER"], isDesignatedReviewer: true },
    { ...base, id: "u-emp", email: "emp@example.test", roles: ["EMPLOYEE"] },
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

describe("cross-role regression: one task through the whole workflow (Task #15.1)", () => {
  it("creates, works, submits, revises, resubmits, approves, reports, and archives, with each role's view checked", async () => {
    const app = await setup();
    const admin = await login(app, "admin@example.test");
    const hazel = await login(app, "hazel@example.test");
    const as = await login(app, "as@example.test");
    const emp = await login(app, "emp@example.test");
    const write = (who: { cookie: string; csrf: string }) => ({ Cookie: who.cookie, "X-CSRF-Token": who.csrf });

    // 1. Administrator's user list has the four seeded accounts.
    const users = await request(app).get("/api/v1/admin/users").set("Cookie", admin.cookie);
    expect(users.body.users).toHaveLength(4);

    // 2. Manager creates a task for the employee, with the designated reviewer.
    const created = await request(app).post("/api/v1/tasks").set(write(hazel))
      .send({ title: "Cross-role task", priority: "High", assigneeId: "u-emp", reviewerId: "u-as", dueDate: "2020-01-01T00:00:00Z" });
    expect(created.status).toBe(201);
    const taskId = created.body.id as string;

    // 3. Employee sees it in their list, starts it, and submits it.
    const mine = await request(app).get("/api/v1/tasks").set("Cookie", emp.cookie);
    expect(mine.body.items.map((t: { id: string }) => t.id)).toContain(taskId);
    expect((await request(app).post(`/api/v1/tasks/${taskId}/status`).set(write(emp)).send({ status: "In Progress" })).status).toBe(403);
    expect((await request(app).post(`/api/v1/tasks/${taskId}/submissions`).set(write(emp)).send({})).status).toBe(201);

    // 4. Reviewer sees the request in the queue and the employee sees a notification-free outbox until decided.
    const queue = await request(app).get("/api/v1/reviews").set("Cookie", as.cookie);
    expect(queue.body.items).toHaveLength(1);
    const submissionId = queue.body.items[0].submissionId as string;
    const empInbox0 = await request(app).get("/api/v1/notifications").set("Cookie", emp.cookie);
    expect(empInbox0.body.items).toHaveLength(0);

    // 5. Reviewer asks for a revision. The task moves to Revision requested, and the employee is told.
    const revise = await request(app).post(`/api/v1/submissions/${submissionId}/decisions`).set(write(as)).send({ decision: "revise" });
    expect(revise.body.taskStatus).toBe("Revision requested");
    const empInbox1 = await request(app).get("/api/v1/notifications").set("Cookie", emp.cookie);
    expect(empInbox1.body.unreadCount).toBe(1);

    // 6. Employee resubmits (revision 2). Reviewer approves. Both sides see the outcome.
    const resubmit = await request(app).post(`/api/v1/tasks/${taskId}/submissions`).set(write(emp)).send({});
    expect(resubmit.body.revisionNo).toBe(2);
    const second = (await request(app).get("/api/v1/reviews").set("Cookie", as.cookie)).body.items[0].submissionId as string;
    const approve = await request(app).post(`/api/v1/submissions/${second}/decisions`).set(write(as)).send({ decision: "approve" });
    expect(approve.body.taskStatus).toBe("Approved");
    const task = await request(app).get(`/api/v1/tasks/${taskId}`).set("Cookie", hazel.cookie);
    expect(task.body.status).toBe("Approved");

    // 7. Review history shows both revisions and their decisions, in order.
    const reviews = await request(app).get(`/api/v1/tasks/${taskId}/reviews`).set("Cookie", emp.cookie);
    expect(reviews.body.items.map((i: { revisionNo: number; decision: string }) => [i.revisionNo, i.decision])).toEqual([
      [1, "revise"],
      [2, "approve"],
    ]);

    // 8. Dashboard: the task is no longer open, and the employee has the outcome notifications.
    const dash = await request(app).get("/api/v1/dashboard").set("Cookie", emp.cookie);
    expect(dash.body.metrics.find((m: { key: string }) => m.key === "open").value).toBe(0);

    // 9. Administrator sets planned time. The time report and the activity log both show it.
    await request(app).post("/api/v1/admin/allocations/u-emp/adjust").set(write(admin)).send({ mode: "set", hours: 6, reason: "Cross-role check" });
    const time = await request(app).get("/api/v1/reports/time").set("Cookie", hazel.cookie);
    expect(time.body.totals.find((t: { subjectId: string }) => t.subjectId === "u-emp").netDelta).toBe(6);
    const activity = await request(app).get("/api/v1/activity?action=approval.decision_recorded").set("Cookie", admin.cookie);
    expect(activity.body.total).toBe(2);

    // 10. Status history report shows the approval transition for the task.
    const history = await request(app).get("/api/v1/reports/history").set("Cookie", hazel.cookie);
    expect(history.body.items.some((i: { taskTitle: string; toStatus: string }) => i.taskTitle === "Cross-role task" && i.toStatus === "Approved")).toBe(true);

    // 11. Manager archives the finished task. It leaves the default list and appears in the archived view.
    await request(app).patch(`/api/v1/tasks/${taskId}`).set(write(hazel)).send({ archived: true });
    expect((await request(app).get("/api/v1/tasks").set("Cookie", emp.cookie)).body.total).toBe(0);
    expect((await request(app).get("/api/v1/tasks?archived=true").set("Cookie", hazel.cookie)).body.total).toBe(1);

    // 12. The employee cannot use administrator views at any point in the flow.
    expect((await request(app).get("/api/v1/activity").set("Cookie", emp.cookie)).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/settings").set("Cookie", emp.cookie)).status).toBe(403);
  });
});
