import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemoryResetStore, hashResetToken, newResetToken } from "../auth/reset.js";
import { InMemorySessionStore } from "../auth/session.js";
import type { UserRecord, UserStore } from "./auth.js";
import type { UserAdminStore } from "../auth/reset.js";

async function setup() {
  const adminPw = await hashPassword("admin-password-long");
  const userPw = await hashPassword("original-password-1");
  const records: UserRecord[] = [
    { id: "u-admin", email: "admin@example.test", passwordHash: adminPw, roles: ["ADMINISTRATOR"], status: "active", isDesignatedReviewer: false },
    { id: "u-target", email: "target@example.test", passwordHash: userPw, roles: ["EMPLOYEE"], status: "active", isDesignatedReviewer: false },
    { id: "u-manager", email: "manager@example.test", passwordHash: userPw, roles: ["MANAGER"], status: "active", isDesignatedReviewer: false },
  ];
  const users: UserStore = { findByEmail: async (e) => records.find((r) => r.email === e) ?? null };
  const userAdmin: UserAdminStore = {
    findById: async (id) => {
      const r = records.find((x) => x.id === id);
      return r ? { id: r.id, roles: r.roles, isDesignatedReviewer: r.isDesignatedReviewer } : null;
    },
    setPasswordHash: async (id, hash) => {
      const r = records.find((x) => x.id === id);
      if (r) r.passwordHash = hash;
    },
    getPasswordHash: async (id) => records.find((x) => x.id === id)?.passwordHash ?? null,
  };
  const sessions = new InMemorySessionStore();
  const resets = new InMemoryResetStore();
  const app = createApp({ users, sessions, userAdmin, resets });
  return { app, resets, sessions };
}

async function login(app: ReturnType<typeof createApp>, email: string, password: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
  return { cookie, csrf: res.body.csrfToken as string, status: res.status };
}

describe("administrator-assisted reset (Task #4.3)", () => {
  it("refuses reset-token issue without a session", async () => {
    const { app } = await setup();
    const res = await request(app).post("/api/v1/admin/users/u-target/reset-token");
    expect(res.status).toBe(401);
  });

  it("refuses reset-token issue to a non-administrator", async () => {
    const { app } = await setup();
    const m = await login(app, "manager@example.test", "original-password-1");
    const res = await request(app)
      .post("/api/v1/admin/users/u-target/reset-token")
      .set("Cookie", m.cookie)
      .set("X-CSRF-Token", m.csrf);
    expect(res.status).toBe(403);
  });

  it("issues a token to the administrator, then resets the password once", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test", "admin-password-long");
    const issued = await request(app)
      .post("/api/v1/admin/users/u-target/reset-token")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf);
    expect(issued.status).toBe(201);
    const token = issued.body.token as string;

    const redeem = await request(app)
      .post("/api/v1/auth/reset")
      .send({ token, newPassword: "brand-new-password-9" });
    expect(redeem.status).toBe(204);

    expect((await login(app, "target@example.test", "brand-new-password-9")).status).toBe(200);
    expect((await login(app, "target@example.test", "original-password-1")).status).toBe(401);

    // Single use: the same token cannot be used again.
    const again = await request(app)
      .post("/api/v1/auth/reset")
      .send({ token, newPassword: "another-password-12" });
    expect(again.status).toBe(400);
  });

  it("refuses an unknown token with a generic error", async () => {
    const { app } = await setup();
    const res = await request(app)
      .post("/api/v1/auth/reset")
      .send({ token: newResetToken(), newPassword: "brand-new-password-9" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid-or-expired-token" });
  });

  it("refuses an expired token", async () => {
    const { app, resets } = await setup();
    const token = newResetToken();
    await resets.create({
      userId: "u-target",
      tokenHash: hashResetToken(token),
      issuedById: "u-admin",
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(app)
      .post("/api/v1/auth/reset")
      .send({ token, newPassword: "brand-new-password-9" });
    expect(res.status).toBe(400);
  });

  it("revokes the user's existing sessions after a reset", async () => {
    const { app } = await setup();
    const target = await login(app, "target@example.test", "original-password-1");
    const a = await login(app, "admin@example.test", "admin-password-long");
    const issued = await request(app)
      .post("/api/v1/admin/users/u-target/reset-token")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf);
    await request(app)
      .post("/api/v1/auth/reset")
      .send({ token: issued.body.token as string, newPassword: "brand-new-password-9" });

    const res = await request(app)
      .post("/api/v1/submissions/s-1/decisions")
      .set("Cookie", target.cookie)
      .set("X-CSRF-Token", target.csrf)
      .send({ decision: "approve" });
    expect(res.status).toBe(401);
  });

  it("refuses a new password shorter than 12 characters without consuming the token", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test", "admin-password-long");
    const issued = await request(app)
      .post("/api/v1/admin/users/u-target/reset-token")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf);
    const token = issued.body.token as string;
    const short = await request(app).post("/api/v1/auth/reset").send({ token, newPassword: "short" });
    expect(short.status).toBe(400);
    const ok = await request(app)
      .post("/api/v1/auth/reset")
      .send({ token, newPassword: "brand-new-password-9" });
    expect(ok.status).toBe(204);
  });
});
