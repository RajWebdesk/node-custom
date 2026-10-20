import type { PrismaClient } from "@prisma/client";
import { localParts, REMINDER_SLOT_HOUR, APP_TIMEZONE, nextDay } from "../domain/schedule.js";

// Due-reminder job (spec Module 11, Task #11.4; D-reminder-scheduler approved 2026-10-20).
// The Docker host scheduler runs this job often (for example hourly). It acts only once the 09:00
// America/Toronto slot has started, and only once per slot, using the ReminderRun row as the record.
// Rule (confirmed 2026-10-19): tasks due within 24 hours and overdue tasks, one reminder per task per day.

// A run that has been 'running' longer than this is treated as abandoned (the process stopped mid-run) and reclaimed.
// Matches REMINDER_RUN_LOCK_TTL_SECONDS in .env.example (15 minutes).
export const REMINDER_LOCK_TTL_MINUTES = 15;

export type ReminderOutcome =
  | { status: "before-slot" }
  | { status: "already-done"; slotKey: string }
  | { status: "running"; slotKey: string }
  | { status: "done"; slotKey: string; created: number; skipped: number };

export async function runDueReminders(db: PrismaClient, now: Date = new Date()): Promise<ReminderOutcome> {
  const local = localParts(now, APP_TIMEZONE);
  if (local.hour < REMINDER_SLOT_HOUR) return { status: "before-slot" };

  const slotKey = `${local.date}T${String(REMINDER_SLOT_HOUR).padStart(2, "0")}:00`;
  const existing = await db.reminderRun.findUnique({ where: { slotKey } });
  if (existing?.status === "done") return { status: "already-done", slotKey };
  const cutoff = new Date(now.getTime() - REMINDER_LOCK_TTL_MINUTES * 60_000);
  if (existing?.status === "running" && existing.startedAt > cutoff) return { status: "running", slotKey };

  // Claim the slot. A failed run, or a run abandoned past the lock TTL, is reclaimed; a new slot is created.
  // The update applies only to the exact state that was read, so two processes cannot both claim it.
  if (existing) {
    const claimed = await db.reminderRun.updateMany({
      where: { slotKey, status: existing.status, startedAt: existing.startedAt },
      data: { status: "running", startedAt: now, finishedAt: null },
    });
    if (claimed.count !== 1) return { status: "running", slotKey };
  } else {
    try {
      await db.reminderRun.create({ data: { slotKey, status: "running", startedAt: now } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") return { status: "running", slotKey };
      throw err;
    }
  }

  try {
    const reminderDate = new Date(`${local.date}T00:00:00Z`);
    // Due within 24 hours means due today or tomorrow; anything earlier is overdue. Both are covered by due <= tomorrow.
    const dueBy = new Date(`${nextDay(local.date)}T00:00:00Z`);
    const tasks = await db.task.findMany({
      where: {
        archivedAt: null,
        status: { not: "Approved" },
        dueDate: { not: null, lte: dueBy },
        assignee: { status: "active" },
      },
      select: { id: true, assigneeId: true, dueDate: true },
    });

    let created = 0;
    let skipped = 0;
    for (const task of tasks) {
      try {
        // One reminder per task per calendar day (unique taskId and reminderDate). The record and its notification
        // are written together.
        await db.$transaction(async (tx) => {
          const notification = await tx.notification.create({
            data: {
              recipientId: task.assigneeId,
              kind: "task.reminder",
              taskId: task.id,
              payload: { dueDate: task.dueDate!.toISOString().slice(0, 10), overdue: task.dueDate!.toISOString().slice(0, 10) < local.date },
            },
          });
          await tx.reminder.create({
            data: { taskId: task.id, reminderDate, slotKey, notificationId: notification.id },
          });
        });
        created++;
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") {
          skipped++; // already reminded today
          continue;
        }
        throw err;
      }
    }

    await db.reminderRun.update({ where: { slotKey }, data: { status: "done", finishedAt: new Date() } });
    return { status: "done", slotKey, created, skipped };
  } catch (err) {
    await db.reminderRun.update({ where: { slotKey }, data: { status: "failed", finishedAt: new Date() } });
    throw err;
  }
}
