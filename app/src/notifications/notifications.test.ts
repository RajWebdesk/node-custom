import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../api/app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import { InMemoryAuditStore } from "../audit/audit.js";
import { InMemoryNotificationStore } from "./notification-store.js";
import { pilotTransport, processOutbox, transportFromEnv, type EmailTransport } from "./email.js";
import type { UserRecord, UserStore } from "../api/auth.js";
import type { UserAdminStore } from "../auth/reset.js";

// Module 11 (Tasks #11.1, #11.3) and Module 12 (Tasks #12.1, #12.3), in memory.
const PASSWORD = "notify-test-password-1";

async function setup() {
  const hash = await hashPassword(PASSWORD);
  const base = { passwordHash: hash, status: "active" as const };
  const records: UserRecord[] = [
    { ...base, id: "u-as", email: "as@example.test", roles: ["MANAGER"], isDesignatedReviewer: true },
    { ...base, id: "u-hazel", email: "hazel@example.test", roles: ["MANAGER"], isDesignatedReviewer: false },
    { ...base, id: "u-emp", email: "emp@example.test", roles: ["EMPLOYEE"], isDesignatedReviewer: false },
    { ...base, id: "u-other", email: "other@example.test", roles: ["EMPLOYEE"], isDesignatedReviewer: false },
    { ...base, id: "u-admin", email: "admin@example.test", roles: ["ADMINISTRATOR"], isDesignatedReviewer: false },
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
  const directory = new InMemoryUserDirectory(seed);
  const notifications = new InMemoryNotificationStore();
  const audit = new InMemoryAuditStore();
  const app = createApp({ users, sessions: new InMemorySessionStore(), userAdmin, userDirectory: directory, audit, notifications });
  return { app, notifications, directory };
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
  return { cookie, csrf: res.body.csrfToken as string };
}

async function reviewFlow(app: ReturnType<typeof createApp>, decision: string) {
  const h = await login(app, "hazel@example.test");
  const created = await request(app).post("/api/v1/tasks").set("Cookie", h.cookie).set("X-CSRF-Token", h.csrf)
    .send({ title: "Notify me", priority: "Low", assigneeId: "u-emp", reviewerId: "u-as" });
  const e = await login(app, "emp@example.test");
  const sub = await request(app).post(`/api/v1/tasks/${created.body.id}/submissions`).set("Cookie", e.cookie).set("X-CSRF-Token", e.csrf).send({});
  const as = await login(app, "as@example.test");
  await request(app).post(`/api/v1/submissions/${sub.body.id}/decisions`).set("Cookie", as.cookie).set("X-CSRF-Token", as.csrf).send({ decision });
  return { taskId: created.body.id as string, e, as, h };
}

describe("in-app notifications (Task #11.1)", () => {
  it("tells the reviewer when a submission arrives and the submitter when a decision is made", async () => {
    const { app } = await setup();
    await reviewFlow(app, "approve");
    const as = await login(app, "as@example.test");
    const e = await login(app, "emp@example.test");
    const reviewerInbox = await request(app).get("/api/v1/notifications").set("Cookie", as.cookie);
    expect(reviewerInbox.body.items.map((n: { kind: string }) => n.kind)).toEqual(["review.requested"]);
    const submitterInbox = await request(app).get("/api/v1/notifications").set("Cookie", e.cookie);
    expect(submitterInbox.body.items.map((n: { kind: string }) => n.kind)).toEqual(["review.decided"]);
    expect(submitterInbox.body.unreadCount).toBe(1);
  });

  it("marks a notification read for its owner only, and marks all read", async () => {
    const { app } = await setup();
    await reviewFlow(app, "revise");
    const e = await login(app, "emp@example.test");
    const other = await login(app, "other@example.test");
    const inbox = await request(app).get("/api/v1/notifications").set("Cookie", e.cookie);
    const id = inbox.body.items[0].id as string;
    expect((await request(app).post(`/api/v1/notifications/${id}/read`).set("Cookie", other.cookie).set("X-CSRF-Token", other.csrf)).status).toBe(404);
    expect((await request(app).post(`/api/v1/notifications/${id}/read`).set("Cookie", e.cookie).set("X-CSRF-Token", e.csrf)).status).toBe(204);
    expect((await request(app).get("/api/v1/notifications?unread=true").set("Cookie", e.cookie)).body.items).toHaveLength(0);
    const all = await request(app).post("/api/v1/notifications/read-all").set("Cookie", e.cookie).set("X-CSRF-Token", e.csrf);
    expect(all.body.marked).toBe(0);
  });

  it("refuses the inbox without a session", async () => {
    const { app } = await setup();
    expect((await request(app).get("/api/v1/notifications")).status).toBe(401);
  });
});

describe("email outbox (Task #11.3) and email failures (Task #12.3)", () => {
  it("the pilot transport records emails as suppressed and sends nothing", async () => {
    const { app, notifications, directory } = await setup();
    await reviewFlow(app, "approve");
    const result = await processOutbox({ notifications, users: directory, transport: pilotTransport, limit: 50 });
    expect(result).toEqual({ suppressed: 2, sent: 0, quarantined: 0 });
    expect(await notifications.pendingEmail(50)).toHaveLength(0);
  });

  it("an email failure quarantines the message and never undoes the task or the approval", async () => {
    const { app, notifications, directory } = await setup();
    const flow = await reviewFlow(app, "approve");
    const failing: EmailTransport = {
      suppressed: false,
      send: async () => {
        throw new Error("provider timeout");
      },
    };
    const result = await processOutbox({ notifications, users: directory, transport: failing, limit: 50 });
    expect(result.quarantined).toBe(2);
    // The approval stands: the task is still Approved and the submitter's inbox still shows the decision.
    const task = await request(app).get(`/api/v1/tasks/${flow.taskId}`).set("Cookie", flow.h.cookie);
    expect(task.body.status).toBe("Approved");
    const inbox = await request(app).get("/api/v1/notifications").set("Cookie", flow.e.cookie);
    expect(inbox.body.items[0].kind).toBe("review.decided");
  });

  it("a configured provider is refused until one is integrated, and no setting means the pilot transport", () => {
    expect(transportFromEnv({})).toBe(pilotTransport);
    expect(() => transportFromEnv({ EMAIL_PROVIDER: "someone" })).toThrow(/no provider is integrated/);
  });
});

describe("dashboard (Task #12.1)", () => {
  it("counts only what the signed-in person can see, and reviewers count their own queue", async () => {
    const { app } = await setup();
    await reviewFlow(app, "reject");
    const e = await login(app, "emp@example.test");
    const other = await login(app, "other@example.test");
    const as = await login(app, "as@example.test");

    const mine = await request(app).get("/api/v1/dashboard").set("Cookie", e.cookie);
    expect(mine.status).toBe(200);
    expect(mine.body.metrics.find((m: { key: string }) => m.key === "open").value).toBe(1);
    expect(mine.body.metrics.find((m: { key: string }) => m.key === "unread").value).toBe(1);

    const theirs = await request(app).get("/api/v1/dashboard").set("Cookie", other.cookie);
    expect(theirs.body.metrics.find((m: { key: string }) => m.key === "open").value).toBe(0);

    // The reject leaves the task In Review with no open submission, so the reviewer's queue is empty.
    const reviewer = await request(app).get("/api/v1/dashboard").set("Cookie", as.cookie);
    expect(reviewer.body.metrics.find((m: { key: string }) => m.key === "review").value).toBe(0);
  });

  it("gives administrators the activity log as recent activity", async () => {
    const { app } = await setup();
    await reviewFlow(app, "approve");
    const admin = await login(app, "admin@example.test");
    const res = await request(app).get("/api/v1/dashboard").set("Cookie", admin.cookie);
    expect(res.body.recent.map((r: { text: string }) => r.text)).toContain("approval.decision_recorded");
  });
});
