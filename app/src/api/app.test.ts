import request from "supertest";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createApp } from "./app.js";
import { decideApproval } from "../domain/approval.js";
import { canChangeAllocation, canManageUsers, type Actor } from "../domain/roles.js";

const validEnv = {
  NODE_ENV: "test",
  APP_TIMEZONE: "America/Toronto",
  DATABASE_URL: "postgres://localhost:5432/app",
  SESSION_SECRET: "0123456789abcdef0123",
  PASSWORD_HASH_ALGORITHM: "argon2id",
  REMINDER_SLOT_LOCAL_TIME: "09:00",
};

const admin: Actor = { id: "u-admin", roles: ["ADMINISTRATOR"], isDesignatedReviewer: false };
const manager: Actor = { id: "u-hazel", roles: ["MANAGER"], isDesignatedReviewer: false };
const reviewer: Actor = { id: "u-as", roles: ["MANAGER"], isDesignatedReviewer: true };
const employee: Actor = { id: "u-emp", roles: ["EMPLOYEE"], isDesignatedReviewer: false };

describe("health endpoints", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, validEnv);
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("liveness returns ok", async () => {
    const res = await request(createApp()).get("/health/live");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("readiness returns ready when configuration is valid", async () => {
    const res = await request(createApp()).get("/health/ready");
    expect(res.status).toBe(200);
  });

  it("readiness returns 503 without leaking values when configuration is invalid", async () => {
    process.env.APP_TIMEZONE = "EST";
    const res = await request(createApp()).get("/health/ready");
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain("EST");
  });
});

describe("decision endpoint", () => {
  it("returns 401 until authentication exists", async () => {
    const res = await request(createApp())
      .post("/api/v1/submissions/s-1/decisions")
      .send({ decision: "approve" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await request(createApp()).get("/nope");
    expect(res.status).toBe(404);
  });
});

describe("roles", () => {
  it("only the Administrator changes allocation and manages users", () => {
    expect(canChangeAllocation(admin)).toBe(true);
    expect(canChangeAllocation(manager)).toBe(false);
    expect(canManageUsers(employee)).toBe(false);
  });
});

describe("approval rules", () => {
  const open = { submittedById: "u-emp", alreadyDecided: false };

  it("a Manager who is not the designated reviewer cannot approve", () => {
    const r = decideApproval(manager, open, "approve");
    expect(r).toEqual({ ok: false, reason: "not-designated-reviewer" });
  });

  it("the designated reviewer can approve another person's submission", () => {
    const r = decideApproval(reviewer, open, "approve");
    expect(r.ok).toBe(true);
  });

  it("a reviewer cannot approve their own submission", () => {
    const own = { submittedById: reviewer.id, alreadyDecided: false };
    const r = decideApproval(reviewer, own, "approve");
    expect(r).toEqual({ ok: false, reason: "own-submission" });
  });

  it("a second decision on the same submission is refused", () => {
    const decided = { submittedById: "u-emp", alreadyDecided: true };
    const r = decideApproval(reviewer, decided, "approve");
    expect(r).toEqual({ ok: false, reason: "duplicate-decision" });
  });

  it("rejection is recorded and the task stays In Review", () => {
    const r = decideApproval(reviewer, open, "reject");
    expect(r).toEqual({ ok: true, outcome: "reject", taskStaysInReview: true });
  });
});
