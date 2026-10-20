import { createPrismaClient } from "../db.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaApprovalStore, PrismaResetStore, PrismaUserAdminStore } from "./prisma-stores.js";
import { hashResetToken } from "./reset.js";
import { hashPassword } from "./password.js";

// Runs only against a migrated local database (DATABASE_URL set).
const enabled = Boolean(process.env.DATABASE_URL);
const stamp = Date.now();

describe.skipIf(!enabled)("Prisma reset and approval stores", () => {
  const db = createPrismaClient(process.env.DATABASE_URL ?? "postgresql://unused:unused@localhost:1/unused");
  let reviewerId = "";
  let submitterId = "";
  let taskId = "";
  let submissionId = "";

  beforeAll(async () => {
    const reviewer = await db.user.create({
      data: { email: `rev-${stamp}@example.test`, name: "Reviewer", passwordHash: await hashPassword("integration-test-password"), isDesignatedReviewer: true, roles: { create: [{ role: "MANAGER" }] } },
    });
    const submitter = await db.user.create({
      data: { email: `sub-${stamp}@example.test`, name: "Submitter", passwordHash: await hashPassword("integration-test-password"), roles: { create: [{ role: "EMPLOYEE" }] } },
    });
    reviewerId = reviewer.id;
    submitterId = submitter.id;
    const task = await db.task.create({
      data: { title: "Integration task", priority: "placeholder", status: "In Review", assigneeId: submitterId, pmId: reviewerId, reviewerId },
    });
    taskId = task.id;
    const sub = await db.approvalSubmission.create({
      data: { taskId, submittedById: submitterId, revisionNo: 1 },
    });
    submissionId = sub.id;
  });

  afterAll(async () => {
    await db.approvalDecision.deleteMany({ where: { submissionId } });
    await db.approvalSubmission.deleteMany({ where: { id: submissionId } });
    await db.taskStatusHistory.deleteMany({ where: { taskId } });
    await db.task.deleteMany({ where: { id: taskId } });
    await db.passwordReset.deleteMany({ where: { userId: { in: [reviewerId, submitterId] } } });
    await db.session.deleteMany({ where: { userId: { in: [reviewerId, submitterId] } } });
    await db.userRole.deleteMany({ where: { userId: { in: [reviewerId, submitterId] } } });
    await db.user.deleteMany({ where: { id: { in: [reviewerId, submitterId] } } });
    await db.$disconnect();
  });

  it("stores only the hash of a reset token and marks it used once", async () => {
    const store = new PrismaResetStore(db);
    const tokenHash = hashResetToken("integration-token-value-0001");
    const created = await store.create({ userId: submitterId, tokenHash, issuedById: reviewerId, expiresAt: new Date(Date.now() + 60_000) });
    expect((await store.findByTokenHash(tokenHash))?.id).toBe(created.id);
    await store.markUsed(created.id);
    const after = await store.findByTokenHash(tokenHash);
    expect(after?.usedAt).not.toBeNull();
  });

  it("sets a new password hash for a user", async () => {
    const admin = new PrismaUserAdminStore(db);
    const before = (await db.user.findUnique({ where: { id: submitterId } }))!.passwordHash;
    const newHash = await hashPassword("changed-password-123");
    await admin.setPasswordHash(submitterId, newHash);
    const after = (await db.user.findUnique({ where: { id: submitterId } }))!.passwordHash;
    expect(after).not.toBe(before);
    expect(after).toBe(newHash);
  });

  it("finds a submission with its designated reviewer, and accepts one decision only", async () => {
    const store = new PrismaApprovalStore(db);
    const before = await store.findSubmission(submissionId);
    expect(before?.reviewerId).toBe(reviewerId);
    expect(before?.decision).toBeNull();
    // Reject keeps the task In Review, so there is no status change (toStatus null).
    await store.decide({ submissionId, decidedById: reviewerId, decision: "reject", fromStatus: "In Review", toStatus: null, audit: { actorId: reviewerId, action: "approval.decision_recorded", entityType: "ApprovalSubmission", entityId: submissionId, payload: {} }, notifications: [] });
    const after = await store.findSubmission(submissionId);
    expect(after?.decision).toBe("reject");
    await expect(
      store.decide({ submissionId, decidedById: reviewerId, decision: "approve", fromStatus: "In Review", toStatus: "Approved", audit: { actorId: reviewerId, action: "approval.decision_recorded", entityType: "ApprovalSubmission", entityId: submissionId, payload: {} }, notifications: [] }),
    ).rejects.toThrow();
    expect((await db.approvalDecision.count({ where: { submissionId } }))).toBe(1);
  });
});
