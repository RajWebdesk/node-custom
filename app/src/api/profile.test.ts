import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import type { UserAdminStore } from "../auth/reset.js";
import type { UserRecord, UserStore } from "./auth.js";

const PASSWORD = "current-password-1";

async function setup() {
  const hash = await hashPassword(PASSWORD);
  const records: UserRecord[] = [
    { id: "u-employee", email: "employee@example.test", passwordHash: hash, roles: ["EMPLOYEE"], status: "active", isDesignatedReviewer: false },
    { id: "u-other", email: "other@example.test", passwordHash: hash, roles: ["EMPLOYEE"], status: "active", isDesignatedReviewer: false },
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
    id: r.id,
    name: r.id,
    email: r.email,
    roles: r.roles,
    status: r.status,
    isDesignatedReviewer: r.isDesignatedReviewer,
  }));
  const app = createApp({
    users,
    sessions: new InMemorySessionStore(),
    userAdmin,
    userDirectory: new InMemoryUserDirectory(seed),
  });
  return { app };
}

async function login(app: ReturnType<typeof createApp>, email: string, password: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
  return { cookie, csrf: res.body.csrfToken as string, status: res.status };
}

describe("profile (Task #5.2)", () => {
  it("refuses the profile without a session", async () => {
    const { app } = await setup();
    const res = await request(app).get("/api/v1/me");
    expect(res.status).toBe(401);
  });

  it("returns only the signed-in user's own profile, without the password hash", async () => {
    const { app } = await setup();
    const s = await login(app, "employee@example.test", PASSWORD);
    const res = await request(app).get("/api/v1/me").set("Cookie", s.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "u-employee", email: "employee@example.test" });
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("requires the CSRF token to change the name, and refuses role or status fields", async () => {
    const { app } = await setup();
    const s = await login(app, "employee@example.test", PASSWORD);
    const noCsrf = await request(app).patch("/api/v1/me").set("Cookie", s.cookie).send({ name: "New Name" });
    expect(noCsrf.status).toBe(403);
    const extra = await request(app)
      .patch("/api/v1/me")
      .set("Cookie", s.cookie)
      .set("X-CSRF-Token", s.csrf)
      .send({ name: "New Name", roles: ["ADMINISTRATOR"] });
    expect(extra.status).toBe(400);
    const ok = await request(app)
      .patch("/api/v1/me")
      .set("Cookie", s.cookie)
      .set("X-CSRF-Token", s.csrf)
      .send({ name: "New Name" });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("New Name");
    expect(ok.body.roles).toEqual(["EMPLOYEE"]);
  });

  it("refuses a password change without the CSRF token", async () => {
    const { app } = await setup();
    const s = await login(app, "employee@example.test", PASSWORD);
    const res = await request(app)
      .post("/api/v1/me/password")
      .set("Cookie", s.cookie)
      .send({ currentPassword: PASSWORD, newPassword: "brand-new-password-2" });
    expect(res.status).toBe(403);
  });

  it("refuses a wrong current password, an unchanged password, and a short new password", async () => {
    const { app } = await setup();
    const s = await login(app, "employee@example.test", PASSWORD);
    const wrong = await request(app)
      .post("/api/v1/me/password")
      .set("Cookie", s.cookie)
      .set("X-CSRF-Token", s.csrf)
      .send({ currentPassword: "not-the-password", newPassword: "brand-new-password-2" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("current-password-incorrect");

    const same = await request(app)
      .post("/api/v1/me/password")
      .set("Cookie", s.cookie)
      .set("X-CSRF-Token", s.csrf)
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.error).toBe("password-unchanged");

    const short = await request(app)
      .post("/api/v1/me/password")
      .set("Cookie", s.cookie)
      .set("X-CSRF-Token", s.csrf)
      .send({ currentPassword: PASSWORD, newPassword: "short" });
    expect(short.status).toBe(400);
  });

  it("changes the password, signs out every session, and accepts only the new password", async () => {
    const { app } = await setup();
    const s = await login(app, "employee@example.test", PASSWORD);
    const other = await login(app, "employee@example.test", PASSWORD);

    const res = await request(app)
      .post("/api/v1/me/password")
      .set("Cookie", s.cookie)
      .set("X-CSRF-Token", s.csrf)
      .send({ currentPassword: PASSWORD, newPassword: "brand-new-password-2" });
    expect(res.status).toBe(204);

    const afterCurrent = await request(app).get("/api/v1/me").set("Cookie", s.cookie);
    expect(afterCurrent.status).toBe(401);
    const afterOther = await request(app).get("/api/v1/me").set("Cookie", other.cookie);
    expect(afterOther.status).toBe(401);

    const oldLogin = await login(app, "employee@example.test", PASSWORD);
    expect(oldLogin.status).toBe(401);
    const newLogin = await login(app, "employee@example.test", "brand-new-password-2");
    expect(newLogin.status).toBe(200);
  });

  it("does not let one user change another user's password", async () => {
    const { app } = await setup();
    const other = await login(app, "other@example.test", PASSWORD);
    await request(app)
      .post("/api/v1/me/password")
      .set("Cookie", other.cookie)
      .set("X-CSRF-Token", other.csrf)
      .send({ currentPassword: PASSWORD, newPassword: "other-new-password-3" });
    // The employee's password is unchanged: the original still works.
    const employee = await login(app, "employee@example.test", PASSWORD);
    expect(employee.status).toBe(200);
  });
});
