import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../api/app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import type { UserRecord, UserStore } from "../api/auth.js";
import type { UserAdminStore } from "../auth/reset.js";
import { InMemoryAuditStore, recordAudit, REDACTED, redact } from "./audit.js";

describe("audit redaction (Task #9.1)", () => {
  it("redacts sensitive keys at any depth and keeps everything else", () => {
    const out = redact({
      name: "Pat",
      passwordHash: "$argon2id$secret",
      nested: { session_token: "abc", csrfToken: "xyz", deeper: [{ newPassword: "hunter2", title: "keep" }] },
      cookie: "sid=1",
      count: 3,
    }) as Record<string, unknown>;
    expect(out.name).toBe("Pat");
    expect(out.count).toBe(3);
    expect(out.passwordHash).toBe(REDACTED);
    expect(out.cookie).toBe(REDACTED);
    const nested = out.nested as Record<string, unknown>;
    expect(nested.session_token).toBe(REDACTED);
    expect(nested.csrfToken).toBe(REDACTED);
    const deeper = (nested.deeper as Record<string, unknown>[])[0];
    expect(deeper.newPassword).toBe(REDACTED);
    expect(deeper.title).toBe("keep");
  });

  it("stores the redacted payload, not the original", async () => {
    const store = new InMemoryAuditStore();
    await recordAudit(store, { actorId: "a", action: "x", entityType: "T", entityId: "1", payload: { password: "p" } });
    expect(store.list()[0].payload).toEqual({ password: REDACTED });
  });

  it("exposes no way to change or remove a stored record", () => {
    const names = [...Object.getOwnPropertyNames(InMemoryAuditStore.prototype)];
    expect(names.some((n) => /update|delete|remove|clear|set/i.test(n))).toBe(false);
  });
});

async function setup() {
  const hash = await hashPassword("audit-test-password-1");
  const base = { passwordHash: hash, status: "active" as const, isDesignatedReviewer: false };
  const records: UserRecord[] = [
    { ...base, id: "u-admin", email: "admin@example.test", roles: ["ADMINISTRATOR"] },
    { ...base, id: "u-manager", email: "manager@example.test", roles: ["MANAGER"] },
    { ...base, id: "u-reviewer", email: "reviewer@example.test", roles: ["MANAGER"], isDesignatedReviewer: true },
    { ...base, id: "u-employee", email: "employee@example.test", roles: ["EMPLOYEE"] },
  ];
  const users: UserStore = { findByEmail: async (e) => records.find((r) => r.email === e) ?? null };
  const userAdmin: UserAdminStore = {
    findById: async (id) => {
      const r = records.find((x) => x.id === id);
      return r ? { id: r.id, roles: r.roles, isDesignatedReviewer: r.isDesignatedReviewer } : null;
    },
    setPasswordHash: async (id, h) => {
      const r = records.find((x) => x.id === id);
      if (r) r.passwordHash = h;
    },
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
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: "audit-test-password-1" });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
  return { cookie, csrf: res.body.csrfToken as string };
}

describe("audit records for business actions (Task #9.1)", () => {
  it("records task creation, a status change, and an archive", async () => {
    const { app, audit } = await setup();
    const m = await login(app, "manager@example.test");
    const created = await request(app)
      .post("/api/v1/tasks")
      .set("Cookie", m.cookie)
      .set("X-CSRF-Token", m.csrf)
      .send({ title: "Audited", priority: "Low", assigneeId: "u-employee", reviewerId: "u-reviewer" });
    const id = created.body.id as string;
    await request(app).post(`/api/v1/tasks/${id}/status`).set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send({ status: "In Progress" });
    await request(app).patch(`/api/v1/tasks/${id}`).set("Cookie", m.cookie).set("X-CSRF-Token", m.csrf).send({ archived: true });

    const actions = audit.list().filter((r) => r.entityId === id).map((r) => r.action);
    expect(actions).toEqual(["task.created", "task.status_changed", "task.archived"]);
    const move = audit.list().find((r) => r.action === "task.status_changed")!;
    expect(move).toMatchObject({ actorId: "u-manager", entityType: "Task", payload: { from: "To Do", to: "In Progress" } });
  });

  it("records a password change without any password or hash in the record", async () => {
    const { app, audit } = await setup();
    const e = await login(app, "employee@example.test");
    await request(app)
      .post("/api/v1/me/password")
      .set("Cookie", e.cookie)
      .set("X-CSRF-Token", e.csrf)
      .send({ currentPassword: "audit-test-password-1", newPassword: "audit-new-password-2" });
    const record = audit.list().find((r) => r.action === "user.password_changed");
    expect(record).toBeDefined();
    expect(JSON.stringify(record)).not.toMatch(/audit-new-password-2|argon2|passwordHash/);
  });

  it("records a reset token issue without storing the token", async () => {
    const { app, audit } = await setup();
    const a = await login(app, "admin@example.test");
    const issued = await request(app)
      .post("/api/v1/admin/users/u-employee/reset-token")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf);
    const token = issued.body.token as string;
    const record = audit.list().find((r) => r.action === "user.reset_token_issued");
    expect(record).toMatchObject({ actorId: "u-admin", entityId: "u-employee" });
    expect(JSON.stringify(audit.list())).not.toContain(token);
  });

  it("writes no record for a refused action", async () => {
    const { app, audit } = await setup();
    const e = await login(app, "employee@example.test");
    await request(app)
      .post("/api/v1/tasks")
      .set("Cookie", e.cookie)
      .set("X-CSRF-Token", e.csrf)
      .send({ title: "Refused", priority: "Low", assigneeId: "u-employee", reviewerId: "u-reviewer" });
    expect(audit.list()).toHaveLength(0);
  });
});
