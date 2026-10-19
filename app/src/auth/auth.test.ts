import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../api/app.js";
import { hashPassword, verifyPassword } from "./password.js";
import { InMemorySessionStore } from "./session.js";
import type { UserRecord, UserStore } from "../api/auth.js";

async function makeUsers(): Promise<{ users: UserStore; records: UserRecord[] }> {
  const passwordHash = await hashPassword("correct-horse-battery");
  const records: UserRecord[] = [
    { id: "u-1", email: "admin@example.test", passwordHash, roles: ["ADMINISTRATOR"], status: "active", isDesignatedReviewer: false },
    { id: "u-2", email: "off@example.test", passwordHash, roles: ["EMPLOYEE"], status: "deactivated", isDesignatedReviewer: false },
  ];
  const users: UserStore = {
    findByEmail: async (email) => records.find((r) => r.email === email) ?? null,
  };
  return { users, records };
}

function cookieFrom(res: request.Response): string {
  const raw = res.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first.split(";")[0];
}

describe("password hashing (D2, Argon2id)", () => {
  it("stores an Argon2id hash, not the plaintext", async () => {
    const h = await hashPassword("s3cret-value");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).not.toContain("s3cret-value");
    expect(await verifyPassword(h, "s3cret-value")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
  });

  it("treats a malformed stored hash as a failed check", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });
});

describe("login and sessions (D1)", () => {
  it("logs in with correct credentials and sets an HttpOnly, SameSite=Strict cookie", async () => {
    const { users } = await makeUsers();
    const app = createApp({ users, sessions: new InMemorySessionStore() });
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@example.test", password: "correct-horse-battery" });
    expect(res.status).toBe(200);
    expect(typeof res.body.csrfToken).toBe("string");
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("returns the same generic failure for a wrong password and an unknown email", async () => {
    const { users } = await makeUsers();
    const app = createApp({ users, sessions: new InMemorySessionStore() });
    const wrongPw = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@example.test", password: "nope" });
    const unknown = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "ghost@example.test", password: "nope" });
    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPw.body).toEqual(unknown.body);
  });

  it("refuses a deactivated account even with the right password", async () => {
    const { users } = await makeUsers();
    const app = createApp({ users, sessions: new InMemorySessionStore() });
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "off@example.test", password: "correct-horse-battery" });
    expect(res.status).toBe(401);
  });

  it("returns 401 to requests without a session", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/submissions/s-1/decisions")
      .send({ decision: "approve" });
    expect(res.status).toBe(401);
  });

  it("refuses state-changing requests without the CSRF token", async () => {
    const { users } = await makeUsers();
    const app = createApp({ users, sessions: new InMemorySessionStore() });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@example.test", password: "correct-horse-battery" });
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookieFrom(login));
    expect(res.status).toBe(403);
  });

  it("accepts logout with the session cookie and CSRF token, then the session is gone", async () => {
    const { users } = await makeUsers();
    const sessions = new InMemorySessionStore();
    const app = createApp({ users, sessions });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@example.test", password: "correct-horse-battery" });
    const csrf = login.body.csrfToken as string;
    const cookie = cookieFrom(login);

    const out = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf);
    expect(out.status).toBe(204);

    const after = await request(app)
      .post("/api/v1/submissions/s-1/decisions")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", csrf)
      .send({ decision: "approve" });
    expect(after.status).toBe(401);
  });

  it("refuses a decision when the signed-in actor cannot be resolved to a user record", async () => {
    const { users } = await makeUsers();
    const app = createApp({ users, sessions: new InMemorySessionStore() });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@example.test", password: "correct-horse-battery" });
    const res = await request(app)
      .post("/api/v1/submissions/s-1/decisions")
      .set("Cookie", cookieFrom(login))
      .set("X-CSRF-Token", login.body.csrfToken as string)
      .send({ decision: "approve" });
    // Authentication and CSRF passed, but this test app has no user-record store for the actor, so it is refused.
    expect(res.status).toBe(403);
  });
});

describe("CORS for the web origin", () => {
  it("allows the configured web origin with credentials", async () => {
    const res = await request(createApp())
      .options("/api/v1/auth/login")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not allow other origins", async () => {
    const res = await request(createApp())
      .get("/health/live")
      .set("Origin", "https://evil.example.test");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
