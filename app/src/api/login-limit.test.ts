import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import type { UserAdminStore } from "../auth/reset.js";
import type { UserRecord, UserStore } from "./auth.js";

// Route-level check of the sign-in failure limit (pilot decision, 2026-10-21).
const PASSWORD = "current-password-1";

async function setup() {
  const hash = await hashPassword(PASSWORD);
  const records: UserRecord[] = [
    { id: "u-a", email: "a@example.test", passwordHash: hash, roles: ["EMPLOYEE"], status: "active", isDesignatedReviewer: false },
    { id: "u-b", email: "b@example.test", passwordHash: hash, roles: ["EMPLOYEE"], status: "active", isDesignatedReviewer: false },
  ];
  const users: UserStore = { findByEmail: async (e) => records.find((r) => r.email === e) ?? null };
  const userAdmin: UserAdminStore = {
    findById: async () => null,
    setPasswordHash: async () => undefined,
    getPasswordHash: async () => null,
  };
  const seed: UserView[] = records.map((r) => ({ id: r.id, name: r.id, email: r.email, roles: r.roles, status: r.status, isDesignatedReviewer: r.isDesignatedReviewer }));
  return createApp({ users, sessions: new InMemorySessionStore(), userAdmin, userDirectory: new InMemoryUserDirectory(seed) });
}

const attempt = (app: Awaited<ReturnType<typeof setup>>, email: string, password: string) =>
  request(app).post("/api/v1/auth/login").set("X-Forwarded-For", "203.0.113.7").send({ email, password });

describe("sign-in failure limit (routes)", () => {
  it("refuses the sixth attempt on an account even with the right password", async () => {
    const app = await setup();
    for (let i = 0; i < 5; i++) expect((await attempt(app, "a@example.test", "wrong-password-x")).status).toBe(401);
    const blocked = await attempt(app, "a@example.test", PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: "too-many-attempts" });
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.headers["set-cookie"]).toBeUndefined();
  });

  it("clears the account's failures after a successful sign-in", async () => {
    const app = await setup();
    for (let i = 0; i < 4; i++) await attempt(app, "a@example.test", "wrong-password-x");
    expect((await attempt(app, "a@example.test", PASSWORD)).status).toBe(200);
    // Four failures were cleared, so the account can fail four more times before the limit applies.
    // (The IP still counts its failures; four is below the IP limit of five.)
    expect((await attempt(app, "a@example.test", PASSWORD)).status).toBe(200);
  });

  it("limits one IP across accounts, so guessing many emails from one address is slowed", async () => {
    const app = await setup();
    for (let i = 0; i < 5; i++) await attempt(app, `nobody${i}@example.test`, "wrong-password-x");
    const other = await attempt(app, "b@example.test", PASSWORD);
    expect(other.status).toBe(429);
  });
});
