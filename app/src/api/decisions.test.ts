import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemoryResetStore } from "../auth/reset.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryApprovalStore } from "./decisions.js";
import type { UserRecord, UserStore } from "./auth.js";
import type { UserAdminStore } from "../auth/reset.js";

// Designated reviewer is AS (u-as, flag true). Submitter is u-emp. Task reviewer is u-as.
async function setup() {
  const pw = await hashPassword("reviewer-password-1");
  const records: UserRecord[] = [
    { id: "u-as", email: "as@example.test", passwordHash: pw, roles: ["MANAGER"], status: "active", isDesignatedReviewer: true },
    { id: "u-hazel", email: "hazel@example.test", passwordHash: pw, roles: ["MANAGER"], status: "active", isDesignatedReviewer: false },
    { id: "u-emp", email: "emp@example.test", passwordHash: pw, roles: ["EMPLOYEE"], status: "active", isDesignatedReviewer: false },
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
  const approvals = new InMemoryApprovalStore();
  approvals.add({ id: "s-1", taskId: "t-1", submittedById: "u-emp", reviewerId: "u-as", alreadyDecided: false });
  approvals.add({ id: "s-own", taskId: "t-2", submittedById: "u-as", reviewerId: "u-as", alreadyDecided: false });
  approvals.add({ id: "s-hazel", taskId: "t-3", submittedById: "u-emp", reviewerId: "u-as", alreadyDecided: false });
  const app = createApp({ users, sessions: new InMemorySessionStore(), userAdmin, resets: new InMemoryResetStore(), approvals });
  return app;
}

async function asSession(app: ReturnType<typeof createApp>, email: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: "reviewer-password-1" });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
  return { cookie, csrf: res.body.csrfToken as string };
}

describe("approval decisions (Module 10)", () => {
  it("the designated reviewer can approve another person's submission", async () => {
    const app = await setup();
    const s = await asSession(app, "as@example.test");
    const res = await request(app)
      .post("/api/v1/submissions/s-1/decisions")
      .set("Cookie", s.cookie).set("X-CSRF-Token", s.csrf)
      .send({ decision: "approve" });
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe("approve");
  });

  it("a Manager who is not the designated reviewer cannot decide", async () => {
    const app = await setup();
    const s = await asSession(app, "hazel@example.test");
    const res = await request(app)
      .post("/api/v1/submissions/s-hazel/decisions")
      .set("Cookie", s.cookie).set("X-CSRF-Token", s.csrf)
      .send({ decision: "approve" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });
  });

  it("the designated reviewer cannot approve their own submission", async () => {
    const app = await setup();
    const s = await asSession(app, "as@example.test");
    const res = await request(app)
      .post("/api/v1/submissions/s-own/decisions")
      .set("Cookie", s.cookie).set("X-CSRF-Token", s.csrf)
      .send({ decision: "approve" });
    expect(res.status).toBe(403);
  });

  it("a second decision on the same submission is refused", async () => {
    const app = await setup();
    const s = await asSession(app, "as@example.test");
    const headers = { Cookie: s.cookie, "X-CSRF-Token": s.csrf };
    await request(app).post("/api/v1/submissions/s-1/decisions").set(headers).send({ decision: "revise" });
    const again = await request(app).post("/api/v1/submissions/s-1/decisions").set(headers).send({ decision: "approve" });
    expect(again.status).toBe(409);
  });

  it("rejection is recorded and the task stays In Review", async () => {
    const app = await setup();
    const s = await asSession(app, "as@example.test");
    const res = await request(app)
      .post("/api/v1/submissions/s-1/decisions")
      .set("Cookie", s.cookie).set("X-CSRF-Token", s.csrf)
      .send({ decision: "reject" });
    expect(res.status).toBe(201);
    expect(res.body.taskStaysInReview).toBe(true);
  });
});
