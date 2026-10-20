import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import type { UserRecord, UserStore } from "./auth.js";

const PASSWORD = "long-enough-password-1";

async function setup() {
  const hash = await hashPassword(PASSWORD);
  const records: UserRecord[] = [
    { id: "u-admin", email: "admin@example.test", passwordHash: hash, roles: ["ADMINISTRATOR"], status: "active", isDesignatedReviewer: false },
    { id: "u-manager", email: "manager@example.test", passwordHash: hash, roles: ["MANAGER"], status: "active", isDesignatedReviewer: false },
    { id: "u-employee", email: "employee@example.test", passwordHash: hash, roles: ["EMPLOYEE"], status: "active", isDesignatedReviewer: false },
  ];
  const users: UserStore = { findByEmail: async (e) => records.find((r) => r.email === e) ?? null };
  const seed: UserView[] = records.map((r) => ({
    id: r.id,
    name: r.id,
    email: r.email,
    roles: r.roles,
    status: r.status,
    isDesignatedReviewer: r.isDesignatedReviewer,
  }));
  const directory = new InMemoryUserDirectory(seed);
  const sessions = new InMemorySessionStore();
  const app = createApp({ users, sessions, userDirectory: directory });
  return { app, sessions };
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
  return { cookie, csrf: res.body.csrfToken as string, status: res.status };
}

describe("user administration: authorization (Task #5.1, #5.3)", () => {
  it("refuses the user list without a session", async () => {
    const { app } = await setup();
    const res = await request(app).get("/api/v1/admin/users");
    expect(res.status).toBe(401);
  });

  it("refuses the user list to a Manager and an Employee", async () => {
    const { app } = await setup();
    for (const email of ["manager@example.test", "employee@example.test"]) {
      const s = await login(app, email);
      const res = await request(app).get("/api/v1/admin/users").set("Cookie", s.cookie);
      expect(res.status).toBe(403);
    }
  });

  it("lists users for an Administrator without password hashes", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test");
    const res = await request(app).get("/api/v1/admin/users").set("Cookie", a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(3);
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("refuses writes without the CSRF token", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test");
    const created = await request(app)
      .post("/api/v1/admin/users")
      .set("Cookie", a.cookie)
      .send({ name: "New", email: "new@example.test", roles: ["EMPLOYEE"] });
    expect(created.status).toBe(403);
    const patched = await request(app)
      .patch("/api/v1/admin/users/u-employee")
      .set("Cookie", a.cookie)
      .send({ name: "Renamed" });
    expect(patched.status).toBe(403);
  });

  it("refuses writes from a Manager and an Employee", async () => {
    const { app } = await setup();
    for (const email of ["manager@example.test", "employee@example.test"]) {
      const s = await login(app, email);
      const created = await request(app)
        .post("/api/v1/admin/users")
        .set("Cookie", s.cookie)
        .set("X-CSRF-Token", s.csrf)
        .send({ name: "New", email: "new@example.test", roles: ["EMPLOYEE"] });
      expect(created.status).toBe(403);
      const patched = await request(app)
        .patch("/api/v1/admin/users/u-employee")
        .set("Cookie", s.cookie)
        .set("X-CSRF-Token", s.csrf)
        .send({ name: "Renamed" });
      expect(patched.status).toBe(403);
    }
  });
});

describe("user administration: create and update", () => {
  it("creates a user and rejects a duplicate email", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test");
    const created = await request(app)
      .post("/api/v1/admin/users")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({ name: "New Person", email: "  New@Example.test ", roles: ["EMPLOYEE"] });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "New Person", email: "new@example.test", roles: ["EMPLOYEE"], status: "active" });
    expect(JSON.stringify(created.body)).not.toContain("passwordHash");

    const dup = await request(app)
      .post("/api/v1/admin/users")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({ name: "Again", email: "new@example.test", roles: ["EMPLOYEE"] });
    expect(dup.status).toBe(409);
  });

  it("rejects invalid create input", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test");
    const res = await request(app)
      .post("/api/v1/admin/users")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({ name: "No Roles", email: "x@example.test", roles: [] });
    expect(res.status).toBe(400);
    const badRole = await request(app)
      .post("/api/v1/admin/users")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({ name: "Bad", email: "y@example.test", roles: ["SUPERUSER"] });
    expect(badRole.status).toBe(400);
  });

  it("refuses an empty patch and an unknown user", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test");
    const empty = await request(app)
      .patch("/api/v1/admin/users/u-employee")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({});
    expect(empty.status).toBe(400);
    const missing = await request(app)
      .patch("/api/v1/admin/users/u-nobody")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({ name: "Nobody" });
    expect(missing.status).toBe(404);
  });

  it("an Administrator cannot deactivate themselves or remove their own Administrator role", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test");
    const deactivate = await request(app)
      .patch("/api/v1/admin/users/u-admin")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({ status: "deactivated" });
    expect(deactivate.status).toBe(409);
    const demote = await request(app)
      .patch("/api/v1/admin/users/u-admin")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({ roles: ["MANAGER"] });
    expect(demote.status).toBe(409);
  });

  it("deactivating a user revokes their existing session", async () => {
    const { app } = await setup();
    const e = await login(app, "employee@example.test");
    const before = await request(app).get("/api/v1/admin/users").set("Cookie", e.cookie);
    expect(before.status).toBe(403); // authenticated, but not an Administrator

    const a = await login(app, "admin@example.test");
    const res = await request(app)
      .patch("/api/v1/admin/users/u-employee")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({ status: "deactivated" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("deactivated");

    const after = await request(app).get("/api/v1/admin/users").set("Cookie", e.cookie);
    expect(after.status).toBe(401);
  });

  it("changing an Employee's role to Manager applies and revokes their session", async () => {
    const { app } = await setup();
    const e = await login(app, "employee@example.test");
    const a = await login(app, "admin@example.test");
    const res = await request(app)
      .patch("/api/v1/admin/users/u-employee")
      .set("Cookie", a.cookie)
      .set("X-CSRF-Token", a.csrf)
      .send({ roles: ["MANAGER"] });
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual(["MANAGER"]);
    const after = await request(app).get("/api/v1/admin/users").set("Cookie", e.cookie);
    expect(after.status).toBe(401);
  });
});
