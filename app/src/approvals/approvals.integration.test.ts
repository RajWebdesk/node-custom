import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../db.js";
import { PrismaApprovalStore } from "../auth/prisma-stores.js";
import { DuplicateDecisionError, StaleApprovalError } from "./approval-store.js";

// Task #10.5 (approval concurrency) against the real database. Runs only when DATABASE_URL is set.
// Audit rows are append-only, so this test leaves its audit rows behind by design.

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? createPrismaClient() : (null as never);

describe.runIf(enabled)("approval concurrency (Task #10.5)", () => {
  const run = randomBytes(4).toString("hex");
  const reviewerId = `appr-as-${run}`;
  const submitterId = `appr-emp-${run}`;
  const taskIds: string[] = [];
  const submissionIds: string[] = [];

  const audit = (actorId: string, entityId: string) => ({ actorId, action: "approval.test", entityType: "ApprovalSubmission", entityId, payload: {} });

  async function newTask(status: string): Promise<string> {
    const id = `appr-task-${randomBytes(6).toString("hex")}`;
    await db.task.create({
      data: { id, title: "Concurrent", priority: "Medium", status, assigneeId: submitterId, pmId: reviewerId, reviewerId },
    });
    taskIds.push(id);
    return id;
  }

  beforeAll(async () => {
    await db.user.createMany({
      data: [
        { id: reviewerId, name: "Reviewer", email: `${reviewerId}@example.test`, passwordHash: "x", status: "active", isDesignatedReviewer: true },
        { id: submitterId, name: "Submitter", email: `${submitterId}@example.test`, passwordHash: "x", status: "active" },
      ],
    });
  });

  afterAll(async () => {
    await db.approvalDecision.deleteMany({ where: { submission: { taskId: { in: taskIds } } } });
    await db.approvalSubmission.deleteMany({ where: { taskId: { in: taskIds } } });
    await db.taskStatusHistory.deleteMany({ where: { taskId: { in: taskIds } } });
    await db.task.deleteMany({ where: { id: { in: taskIds } } });
    await db.user.deleteMany({ where: { id: { in: [reviewerId, submitterId] } } });
    await db.$disconnect();
  });

  it("lets exactly one of several simultaneous decisions through, and keeps the task consistent with it", async () => {
    const store = new PrismaApprovalStore(db);
    const taskId = await newTask("In Review");
    const sub = await db.approvalSubmission.create({ data: { taskId, submittedById: submitterId, revisionNo: 1 } });
    submissionIds.push(sub.id);

    const decisions = ["approve", "revise", "reject", "approve", "revise", "reject"] as const;
    const results = await Promise.allSettled(
      decisions.map((decision) =>
        store.decide({
          submissionId: sub.id,
          decidedById: reviewerId,
          decision,
          fromStatus: "In Review",
          toStatus: decision === "approve" ? "Approved" : decision === "revise" ? "Revision requested" : null,
          audit: audit(reviewerId, sub.id),
          notifications: [],
        }),
      ),
    );
    const won = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected" && (r.reason instanceof DuplicateDecisionError || r.reason instanceof StaleApprovalError));
    expect(won).toHaveLength(1);
    expect(refused).toHaveLength(decisions.length - 1);

    // One decision row, and the task status matches the winning decision.
    expect(await db.approvalDecision.count({ where: { submissionId: sub.id } })).toBe(1);
    const winner = (won[0] as PromiseFulfilledResult<{ decision: string }>).value.decision;
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    const expected = winner === "approve" ? "Approved" : winner === "revise" ? "Revision requested" : "In Review";
    expect(task.status).toBe(expected);
  });

  it("lets exactly one of several simultaneous submissions through to the task's first revision", async () => {
    const store = new PrismaApprovalStore(db);
    const taskId = await newTask("To Do");
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () => {
        const submissionId = randomBytes(16).toString("hex");
        return store.submit(
          { submissionId, taskId, submittedById: submitterId, fromStatus: "To Do", toStatus: "In Review", audit: audit(submitterId, submissionId), notifications: [] },
          submitterId,
        );
      }),
    );
    const won = attempts.filter((a) => a.status === "fulfilled") as PromiseFulfilledResult<{ id: string; revisionNo: number }>[];
    expect(won).toHaveLength(1);
    expect(won[0].value.revisionNo).toBe(1);
    const rows = await db.approvalSubmission.findMany({ where: { taskId } });
    submissionIds.push(...rows.map((r) => r.id));
    expect(rows).toHaveLength(1);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("In Review");
  });
});
