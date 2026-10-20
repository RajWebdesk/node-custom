import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "../auth/password.js";
import { InMemorySessionStore } from "../auth/session.js";
import { InMemoryUserDirectory, type UserView } from "../auth/user-directory.js";
import type { UserRecord, UserStore } from "./auth.js";
import type { UserAdminStore } from "../auth/reset.js";
import { InMemoryAuditStore, type AuditReader, type AuditStore, type AuditRecord } from "../audit/audit.js";
import { InMemoryAllocationStore, StaleAllocationError } from "../allocation/allocation-store.js";
import { computeAdjustment } from "../domain/allocation.js";

const PASSWORD = "allocation-test-password-1";

async function setup(audit: AuditStore & AuditReader = new InMemoryAuditStore()) {
  const hash = await hashPassword(PASSWORD);
  const base = { passwordHash: hash, isDesignatedReviewer: false };
  const records: UserRecord[] = [
    { ...base, id: "u-admin", email: "admin@example.test", roles: ["ADMINISTRATOR"], status: "active" },
    { ...base, id: "u-manager", email: "manager@example.test", roles: ["MANAGER"], status: "active" },
    { ...base, id: "u-employee", email: "employee@example.test", roles: ["EMPLOYEE"], status: "active" },
    { ...base, id: "u-other", email: "other@example.test", roles: ["EMPLOYEE"], status: "active" },
    { ...base, id: "u-gone", email: "gone@example.test", roles: ["EMPLOYEE"], status: "deactivated" },
  ];
  const users: UserStore = { findByEmail: async (e) => records.find((r) => r.email === e) ?? null };
  const userAdmin: UserAdminStore = {
    findById: async (id) => {
      const r = records.find((x) => x.id === id);
      return r ? { id: r.id, roles: r.roles, isDesignatedReviewer: r.isDesignatedReviewer } : null;
    },
    setPasswordHash: async () => undefined,
    getPasswordHash: async (id) => records.find((x) => x.id === id)?.passwordHash ?? null,
  };
  const seed: UserView[] = records.map((r) => ({
    id: r.id, name: r.id, email: r.email, roles: r.roles, status: r.status, isDesignatedReviewer: r.isDesignatedReviewer,
  }));
  const allocations = new InMemoryAllocationStore(audit);
  const app = createApp({
    users,
    sessions: new InMemorySessionStore(),
    userAdmin,
    userDirectory: new InMemoryUserDirectory(seed),
    audit,
    allocations,
  });
  return { app, audit, allocations };
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  const raw = res.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";")[0] ?? "";
  return { cookie, csrf: res.body.csrfToken as string };
}

function adjust(app: ReturnType<typeof createApp>, s: { cookie: string; csrf: string }, subject: string, body: object) {
  return request(app)
    .post(`/api/v1/admin/allocations/${subject}/adjust`)
    .set("Cookie", s.cookie)
    .set("X-CSRF-Token", s.csrf)
    .send(body);
}

describe("allocation rules (Task #8.1)", () => {
  it("applies set, increase, and decrease, and reports the delta", () => {
    expect(computeAdjustment(0, "set", 10)).toEqual({ ok: true, previousHours: 0, newHours: 10, delta: 10 });
    expect(computeAdjustment(10, "increase", 2.5)).toEqual({ ok: true, previousHours: 10, newHours: 12.5, delta: 2.5 });
    expect(computeAdjustment(12.5, "decrease", 12.5)).toEqual({ ok: true, previousHours: 12.5, newHours: 0, delta: -12.5 });
  });

  it("refuses negative results, no change, bad precision, and values over the column limit", () => {
    expect(computeAdjustment(5, "decrease", 6)).toEqual({ ok: false, reason: "negative-result" });
    expect(computeAdjustment(5, "set", 5)).toEqual({ ok: false, reason: "no-change" });
    expect(computeAdjustment(5, "increase", 1.005)).toEqual({ ok: false, reason: "invalid-hours" });
    expect(computeAdjustment(5, "increase", 0)).toEqual({ ok: false, reason: "invalid-hours" });
    expect(computeAdjustment(5, "set", 10000)).toEqual({ ok: false, reason: "too-large" });
  });
});

describe("allocation permissions (Task #8.2)", () => {
  it("refuses the allocation list without a session", async () => {
    const { app } = await setup();
    expect((await request(app).get("/api/v1/allocations")).status).toBe(401);
  });

  it("shows an employee only their own allocation, and a manager everyone's", async () => {
    const { app } = await setup();
    const e = await login(app, "employee@example.test");
    const own = await request(app).get("/api/v1/allocations").set("Cookie", e.cookie);
    expect(own.body.items.map((i: { subjectId: string }) => i.subjectId)).toEqual(["u-employee"]);
    const m = await login(app, "manager@example.test");
    const all = await request(app).get("/api/v1/allocations").set("Cookie", m.cookie);
    expect(all.body.items.length).toBe(4); // active users only
  });

  it("refuses changes by managers and employees, and changes without the CSRF token", async () => {
    const { app } = await setup();
    for (const email of ["manager@example.test", "employee@example.test"]) {
      const s = await login(app, email);
      expect((await adjust(app, s, "u-other", { mode: "set", hours: 5 })).status).toBe(403);
    }
    const a = await login(app, "admin@example.test");
    const noCsrf = await request(app)
      .post("/api/v1/admin/allocations/u-other/adjust")
      .set("Cookie", a.cookie)
      .send({ mode: "set", hours: 5 });
    expect(noCsrf.status).toBe(403);
  });

  it("lets an employee read their own history and refuses someone else's", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test");
    await adjust(app, a, "u-employee", { mode: "set", hours: 8 });
    const e = await login(app, "employee@example.test");
    expect((await request(app).get("/api/v1/allocations/u-employee/history").set("Cookie", e.cookie)).status).toBe(200);
    expect((await request(app).get("/api/v1/allocations/u-other/history").set("Cookie", e.cookie)).status).toBe(404);
  });
});

describe("allocation changes (Task #8.2, #8.3)", () => {
  it("records previous, new, delta, reason, and actor for each change", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test");
    const first = await adjust(app, a, "u-employee", { mode: "set", hours: 10 });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ previousHours: 0, newHours: 10, delta: 10 });
    const second = await adjust(app, a, "u-employee", { mode: "decrease", hours: 2.5, reason: "Scope reduced" });
    expect(second.body).toMatchObject({ previousHours: 10, newHours: 7.5, delta: -2.5 });

    const hist = await request(app).get("/api/v1/allocations/u-employee/history").set("Cookie", a.cookie);
    expect(hist.body.items[0]).toMatchObject({ previousHours: 10, newHours: 7.5, delta: -2.5, reason: "Scope reduced", actorName: "u-admin" });
    expect(hist.body.items[1]).toMatchObject({ previousHours: 0, newHours: 10, delta: 10, reason: null });
  });

  it("rejects an unknown subject, a deactivated subject, and invalid input", async () => {
    const { app } = await setup();
    const a = await login(app, "admin@example.test");
    expect((await adjust(app, a, "u-nobody", { mode: "set", hours: 5 })).status).toBe(404);
    expect((await adjust(app, a, "u-gone", { mode: "set", hours: 5 })).body.error).toBe("invalid-subject");
    expect((await adjust(app, a, "u-other", { mode: "add", hours: 5 })).status).toBe(400);
    expect((await adjust(app, a, "u-other", { mode: "set", hours: 5, extra: 1 })).status).toBe(400);
  });
});

describe("allocation consistency (Task #9.3, in-memory)", () => {
  it("writes exactly one change and one audit record per successful change, and none for a refused one", async () => {
    const audit = new InMemoryAuditStore();
    const { app, allocations } = await setup(audit);
    const a = await login(app, "admin@example.test");
    await adjust(app, a, "u-other", { mode: "set", hours: 4 });
    await adjust(app, a, "u-other", { mode: "decrease", hours: 9 }); // refused: negative
    await adjust(app, a, "u-other", { mode: "increase", hours: 1 });

    const changes = await allocations.history("u-other");
    const adjusted = audit.list().filter((r: AuditRecord) => r.action === "allocation.adjusted");
    expect(changes).toHaveLength(2);
    expect(adjusted).toHaveLength(2);
    expect(await allocations.findBySubject("u-other")).toMatchObject({ plannedHours: 5 });
  });

  it("leaves no change and no audit record when the audit write fails", async () => {
    const failing: AuditStore = { append: async () => { throw new Error("disk full"); } };
    const allocations = new InMemoryAllocationStore(failing);
    await expect(
      allocations.applyChange({
        subjectId: "u-other", expectedPrevious: null, newHours: 5, reason: null, actorId: "u-admin",
        audit: { actorId: "u-admin", action: "allocation.adjusted", entityType: "Allocation", entityId: "u-other", payload: {} },
      }),
    ).rejects.toThrow("disk full");
    expect(await allocations.findBySubject("u-other")).toBeNull();
    expect(await allocations.history("u-other")).toHaveLength(0);
  });

  it("refuses a change based on a value that has since moved (no lost update)", async () => {
    const audit = new InMemoryAuditStore();
    const allocations = new InMemoryAllocationStore(audit);
    const input = (expectedPrevious: number | null, newHours: number) => ({
      subjectId: "u-other", expectedPrevious, newHours, reason: null, actorId: "u-admin",
      audit: { actorId: "u-admin", action: "allocation.adjusted", entityType: "Allocation", entityId: "u-other", payload: {} },
    });
    await allocations.applyChange(input(null, 10));
    await expect(allocations.applyChange(input(null, 3))).rejects.toBeInstanceOf(StaleAllocationError);
    await expect(allocations.applyChange(input(4, 3))).rejects.toBeInstanceOf(StaleAllocationError);
    expect(await allocations.findBySubject("u-other")).toMatchObject({ plannedHours: 10 });
    expect(await allocations.history("u-other")).toHaveLength(1);
    expect(audit.list()).toHaveLength(1);
  });
});
