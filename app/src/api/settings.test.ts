import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import type { UserRecord, UserStore } from "./auth.js";
import type { UserAdminStore } from "../auth/reset.js";

// Task #13.4: settings view. Administrators only; read-only; no secrets.
const PASSWORD = "settings-test-password-1";

async function setup() {
  const hash = await hashPassword(PASSWORD);
  const base = { passwordHash: hash, status: "active" as const, isDesignatedReviewer: false };
  const records: UserRecord[] = [
    { ...base, id: "u-admin", email: "admin@example.test", roles: ["ADMINISTRATOR"] },
    { ...base, id: "u-manager", email: "manager@example.test", roles: ["MANAGER"] },
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

describe("settings view (Task #13.4)", () => {
  it("refuses the settings view without a session, and to managers and employees", async () => {
    const app = await setup();
    expect((await request(app).get("/api/v1/admin/settings")).status).toBe(401);
    for (const email of ["manager@example.test", "emp@example.test"]) {
      const s = await login(app, email);
      expect((await request(app).get("/api/v1/admin/settings").set("Cookie", s.cookie)).status).toBe(403);
    }
  });

  it("shows the approved settings and the role matrix to administrators, and is read-only", async () => {
    const app = await setup();
    const a = await login(app, "admin@example.test");
    const res = await request(app).get("/api/v1/admin/settings").set("Cookie", a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ timezone: "America/Toronto", reminderSlot: "09:00", passwordMinLength: 12, editable: false });
    expect(res.body.roles.map((r: { role: string }) => r.role)).toEqual(["ADMINISTRATOR", "MANAGER", "EMPLOYEE"]);
    expect(res.body.permissionMatrix.find((r: { module: string }) => r.module === "Activity log").Manager).toBe("None");
    // Read-only: there is no write route for settings.
    expect((await request(app).patch("/api/v1/admin/settings").set("Cookie", a.cookie).set("X-CSRF-Token", a.csrf).send({ timezone: "UTC" })).status).toBe(404);
  });

  it("never returns secrets, connection strings, or provider values", async () => {
    const app = await setup();
    const a = await login(app, "admin@example.test");
    const saved = { ...process.env };
    process.env.SESSION_SECRET = "very-secret-value-for-test-0123";
    process.env.DATABASE_URL = "postgresql://app:hidden-pw@db.example.test:5432/app";
    process.env.EMAIL_PROVIDER = "provider-x";
    try {
      const res = await request(app).get("/api/v1/admin/settings").set("Cookie", a.cookie);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/very-secret-value|hidden-pw|db\.example\.test|provider-x/);
      expect(res.body.settings.emailMode).toBe("provider-not-integrated");
    } finally {
      for (const key of ["SESSION_SECRET", "DATABASE_URL", "EMAIL_PROVIDER"]) {
        if (key in saved) process.env[key] = saved[key];
        else delete process.env[key];
      }
    }
  });
});
