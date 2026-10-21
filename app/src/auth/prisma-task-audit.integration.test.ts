import { createPrismaClient } from "../db.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaTaskStore } from "./prisma-stores.js";
import { StaleStatusError } from "../tasks/task-store.js";

// Known issue 11: a task change and its audit record are written in one transaction.
// Runs only when DATABASE_URL points at a migrated local database.
const enabled = Boolean(process.env.DATABASE_URL);
const run = `${Date.now()}`;
const ids = { manager: `audit-mgr-${run}`, reviewer: `audit-rev-${run}`, assignee: `audit-emp-${run}` };

describe.skipIf(!enabled)("task changes and audit records are atomic (known issue 11)", () => {
  const db = createPrismaClient(process.env.DATABASE_URL ?? "postgresql://unused:unused@localhost:1/unused");
  const store = new PrismaTaskStore(db);
  let taskId = "";

  beforeAll(async () => {
    await db.user.createMany({
      data: [
        { id: ids.manager, name: "Audit Manager", email: `${ids.manager}@example.test`, passwordHash: "x", status: "active" },
        { id: ids.reviewer, name: "Audit Reviewer", email: `${ids.reviewer}@example.test`, passwordHash: "x", status: "active", isDesignatedReviewer: true },
        { id: ids.assignee, name: "Audit Assignee", email: `${ids.assignee}@example.test`, passwordHash: "x", status: "active" },
      ],
    });
    const task = await store.create(
      { title: "Atomic audit task", description: null, priority: "Low", status: "To Do", assigneeId: ids.assignee, pmId: ids.manager, reviewerId: ids.reviewer, startDate: null, dueDate: null },
      { actorId: ids.manager, action: "task.created", payload: { title: "Atomic audit task" } },
    );
    taskId = task.id;
  });

  afterAll(async () => {
    await db.auditEvent.deleteMany({ where: { entityId: taskId } }).catch(() => undefined);
    await db.taskStatusHistory.deleteMany({ where: { taskId } });
    await db.task.deleteMany({ where: { id: taskId } });
    await db.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await db.$disconnect();
  });

  it("writes the audit record with the create", async () => {
    expect(await db.auditEvent.count({ where: { entityId: taskId, action: "task.created" } })).toBe(1);
  });

  it("writes no audit record when a status move is refused as stale", async () => {
    const before = await db.auditEvent.count({ where: { entityId: taskId, action: "task.status_changed" } });
    await expect(
      store.moveStatus({ taskId, fromStatus: "Done", toStatus: "In Progress", actorId: ids.manager }, { actorId: ids.manager, action: "task.status_changed", payload: {} }),
    ).rejects.toBeInstanceOf(StaleStatusError);
    expect(await db.auditEvent.count({ where: { entityId: taskId, action: "task.status_changed" } })).toBe(before);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("To Do");
  });

  it("writes one audit record with a successful status move", async () => {
    await store.moveStatus({ taskId, fromStatus: "To Do", toStatus: "In Progress", actorId: ids.manager }, { actorId: ids.manager, action: "task.status_changed", payload: { from: "To Do", to: "In Progress" } });
    expect(await db.auditEvent.count({ where: { entityId: taskId, action: "task.status_changed" } })).toBe(1);
  });

  it("writes no audit record when the task to update does not exist", async () => {
    const missing = `missing-${run}`;
    expect(await store.update(missing, { title: "x" }, { actorId: ids.manager, action: "task.updated", payload: {} })).toBeNull();
    expect(await db.auditEvent.count({ where: { entityId: missing } })).toBe(0);
  });
});
