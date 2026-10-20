import type { Request, Response } from "express";
import { z } from "zod";
import type { TaskRecord, TaskStore } from "../tasks/task-store.js";
import type { AllocationStore } from "../allocation/allocation-store.js";
import type { UserDirectory } from "../auth/user-directory.js";
import type { SessionRecord } from "../auth/session.js";
import type { Actor, Role } from "../domain/roles.js";
import { canManageTasks } from "../domain/tasks.js";
import { canViewAllocation } from "../domain/allocation.js";
import { localParts, APP_TIMEZONE } from "../domain/schedule.js";
import { validRange } from "../domain/reports.js";

// Time and change-history reports (spec Module 13, Task #13.2). Same visibility as the underlying lists:
// planned-time changes follow canViewAllocation; task status history follows task visibility.
// Dates are Toronto calendar dates. Each list is capped, so the response size is bounded.

export interface HistoryReportDeps {
  tasks: TaskStore;
  allocations: AllocationStore;
  directory: UserDirectory;
}

const LIMIT = 200;
const PAGE = 100;

const query = z.object({
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
});

function inDateRange(at: Date, from: string | null, to: string | null): boolean {
  const day = localParts(at, APP_TIMEZONE).date;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

async function actorOf(deps: HistoryReportDeps, res: Response): Promise<Actor | null> {
  const session = res.locals.session as SessionRecord;
  const user = await deps.directory.findById(session.userId);
  if (!user || user.status !== "active") return null;
  return { id: user.id, roles: session.roles as readonly Role[], isDesignatedReviewer: user.isDesignatedReviewer };
}

async function visibleTasks(deps: HistoryReportDeps, actor: Actor): Promise<TaskRecord[]> {
  const all: TaskRecord[] = [];
  for (let page = 1; ; page++) {
    const { items, total } = await deps.tasks.list({
      archived: false,
      page,
      pageSize: PAGE,
      sortBy: "createdAt",
      sortDir: "asc",
      onlyAssigneeId: canManageTasks(actor) ? undefined : actor.id,
    });
    all.push(...items);
    if (all.length >= total || items.length === 0) return all;
  }
}

// Planned-time changes in the range, with a per-person summary. Administrators and managers see everyone;
// employees see their own changes only.
export function timeReportHandler(deps: HistoryReportDeps) {
  return async (req: Request, res: Response) => {
    try {
      const q = query.safeParse(req.query);
      const from = q.success ? q.data.from ?? null : null;
      const to = q.success ? q.data.to ?? null : null;
      if (!q.success || !validRange(from, to)) {
        res.status(400).json({ error: "invalid-range" });
        return;
      }
      const actor = await actorOf(deps, res);
      if (!actor) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const [allocations, users] = await Promise.all([deps.allocations.list(), deps.directory.list()]);
      const names = new Map(users.map((u) => [u.id, u.name]));
      const subjects = allocations.map((a) => a.subjectId).filter((id) => canViewAllocation(actor, id));
      const changes = [];
      for (const subjectId of subjects) {
        for (const c of await deps.allocations.history(subjectId)) {
          if (inDateRange(c.at, from, to)) {
            changes.push({
              at: c.at,
              subjectId,
              subjectName: names.get(subjectId) ?? "Former user",
              actorName: names.get(c.actorId) ?? "Former user",
              previousHours: c.previousHours,
              newHours: c.newHours,
              delta: c.delta,
              reason: c.reason,
            });
          }
        }
      }
      changes.sort((a, b) => b.at.getTime() - a.at.getTime());

      const totals = new Map<string, { subjectId: string; name: string; changes: number; netDelta: number }>();
      for (const c of changes) {
        const t = totals.get(c.subjectId) ?? { subjectId: c.subjectId, name: c.subjectName, changes: 0, netDelta: 0 };
        t.changes++;
        t.netDelta = Math.round((t.netDelta + c.delta) * 100) / 100;
        totals.set(c.subjectId, t);
      }
      res.status(200).json({
        from,
        to,
        totals: [...totals.values()].sort((a, b) => a.name.localeCompare(b.name)),
        changes: changes.slice(0, LIMIT),
        truncated: changes.length > LIMIT,
      });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

// Task status history in the range, for tasks the caller can see.
export function statusHistoryReportHandler(deps: HistoryReportDeps) {
  return async (req: Request, res: Response) => {
    try {
      const q = query.safeParse(req.query);
      const from = q.success ? q.data.from ?? null : null;
      const to = q.success ? q.data.to ?? null : null;
      if (!q.success || !validRange(from, to)) {
        res.status(400).json({ error: "invalid-range" });
        return;
      }
      const actor = await actorOf(deps, res);
      if (!actor) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const [tasks, users] = await Promise.all([visibleTasks(deps, actor), deps.directory.list()]);
      const names = new Map(users.map((u) => [u.id, u.name]));
      const rows = [];
      for (const task of tasks) {
        for (const h of await deps.tasks.historyFor(task.id)) {
          if (inDateRange(h.at, from, to)) {
            rows.push({
              at: h.at,
              taskId: task.id,
              taskTitle: task.title,
              fromStatus: h.fromStatus,
              toStatus: h.toStatus,
              actorName: names.get(h.actorId) ?? "Former user",
            });
          }
        }
      }
      rows.sort((a, b) => b.at.getTime() - a.at.getTime());
      res.status(200).json({ from, to, items: rows.slice(0, LIMIT), truncated: rows.length > LIMIT });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}
