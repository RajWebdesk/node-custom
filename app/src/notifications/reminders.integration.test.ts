import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../db.js";
import { runDueReminders } from "./reminders.js";

// Task #11.4 (due-reminder job) against the real database. Runs only when DATABASE_URL is set.
// Uses a far-future date so it never collides with real runs. Audit rows are not touched here.

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? createPrismaClient() : (null as never);

describe.runIf(enabled)("due-reminder job (Task #11.4)", () => {
  const run = randomBytes(4).toString("hex");
  const assigneeId = `rem-as-${run}`;
  const reviewerId = `rem-rv-${run}`;
  const SLOT_DAY = "2030-03-14"; // Toronto is UTC-4 on this date (daylight time)
  const SLOT_TIME = new Date("2030-03-14T14:00:00Z"); // 10:00 Toronto, after the 09:00 slot
  const BEFORE_SLOT = new Date("2030-03-14T12:00:00Z"); // 08:00 Toronto
  const taskIds: Record<string, string> = {};

  beforeAll(async () => {
    await db.user.createMany({
      data: [
        { id: assigneeId, name: "Assignee", email: `${assigneeId}@example.test`, passwordHash: "x", status: "active" },
        { id: reviewerId, name: "Reviewer", email: `${reviewerId}@example.test`, passwordHash: "x", status: "active", isDesignatedReviewer: true },
      ],
    });
    const make = async (key: string, due: string, status: string, archived = false) => {
      const task = await db.task.create({
        data: {
          title: key,
          priority: "Low",
          status,
          assigneeId,
          pmId: reviewerId,
          reviewerId,
          dueDate: new Date(`${due}T00:00:00Z`),
          archivedAt: archived ? new Date() : null,
        },
      });
      taskIds[key] = task.id;
    };
    await make("dueToday", SLOT_DAY, "To Do");
    await make("dueTomorrow", "2030-03-15", "In Progress");
    await make("overdue", "2030-03-10", "To Do");
    await make("later", "2030-03-20", "To Do");
    await make("approved", SLOT_DAY, "Approved");
    await make("archived", SLOT_DAY, "To Do", true);
  });

  afterAll(async () => {
    const ids = Object.values(taskIds);
    await db.reminder.deleteMany({ where: { taskId: { in: ids } } });
    await db.notification.deleteMany({ where: { recipientId: assigneeId } });
    await db.reminderRun.deleteMany({ where: { slotKey: `${SLOT_DAY}T09:00` } });
    await db.taskStatusHistory.deleteMany({ where: { taskId: { in: ids } } });
    await db.task.deleteMany({ where: { id: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: [assigneeId, reviewerId] } } });
    await db.$disconnect();
  });

  it("does nothing before the 09:00 slot starts", async () => {
    const outcome = await runDueReminders(db, BEFORE_SLOT);
    expect(outcome.status).toBe("before-slot");
    expect(await db.reminderRun.count({ where: { slotKey: `${SLOT_DAY}T09:00` } })).toBe(0);
  });

  it("reminds the assignee of tasks due within 24 hours and of overdue tasks, and no others", async () => {
    const outcome = await runDueReminders(db, SLOT_TIME);
    expect(outcome.status).toBe("done");
    const reminded = await db.reminder.findMany({ where: { taskId: { in: Object.values(taskIds) } } });
    const ids = reminded.map((r) => r.taskId).sort();
    expect(ids).toEqual([taskIds.dueToday, taskIds.dueTomorrow, taskIds.overdue].sort());

    const notes = await db.notification.findMany({ where: { recipientId: assigneeId, kind: "task.reminder" } });
    expect(notes).toHaveLength(3);
    const overdue = notes.find((n) => n.taskId === taskIds.overdue);
    expect((overdue!.payload as { overdue: boolean }).overdue).toBe(true);
  });

  it("runs once per slot: a second run in the same slot does not repeat the reminders", async () => {
    const again = await runDueReminders(db, SLOT_TIME);
    expect(again.status).toBe("already-done");
    const count = await db.reminder.count({ where: { taskId: { in: Object.values(taskIds) } } });
    expect(count).toBe(3);
  });
});

// G5 recovery drill (milestone regression for the reminder job). Simulates a process that stopped mid-run.
describe.runIf(enabled)("due-reminder recovery drill (G5)", () => {
  const DAY = "2030-03-21";
  const NOW = new Date("2030-03-21T14:00:00Z"); // 10:00 Toronto
  const KEY = `${DAY}T09:00`;

  afterAll(async () => {
    await db.reminderRun.deleteMany({ where: { slotKey: KEY } });
  });

  it("does not run twice while a run is recent, reclaims a run abandoned past the lock, and never repeats a finished slot", async () => {
    // A run that has just started: another process is working on it, so this one stays out.
    await db.reminderRun.create({ data: { slotKey: KEY, status: "running", startedAt: NOW } });
    expect((await runDueReminders(db, NOW)).status).toBe("running");

    // The process died: the run has been 'running' for 60 minutes. The next run reclaims it and finishes.
    await db.reminderRun.update({ where: { slotKey: KEY }, data: { startedAt: new Date(NOW.getTime() - 60 * 60_000) } });
    const recovered = await runDueReminders(db, NOW);
    expect(recovered.status).toBe("done");
    expect((await db.reminderRun.findUniqueOrThrow({ where: { slotKey: KEY } })).status).toBe("done");

    // Once done, the slot is never repeated that day.
    expect((await runDueReminders(db, NOW)).status).toBe("already-done");
  });

  it("reclaims a run that failed earlier and records the new outcome", async () => {
    const failedKey = "2030-03-22T09:00";
    await db.reminderRun.create({ data: { slotKey: failedKey, status: "failed", startedAt: NOW } });
    const outcome = await runDueReminders(db, new Date("2030-03-22T14:00:00Z"));
    expect(outcome.status).toBe("done");
    await db.reminderRun.deleteMany({ where: { slotKey: failedKey } });
  });
});
