import type { Request, Response } from "express";
import { z } from "zod";
import type { TaskRecord, TaskStore } from "../tasks/task-store.js";
import type { UserDirectory } from "../auth/user-directory.js";
import type { SessionRecord } from "../auth/session.js";
import type { Actor, Role } from "../domain/roles.js";
import { canManageTasks } from "../domain/tasks.js";
import { localParts, APP_TIMEZONE } from "../domain/schedule.js";
import { DATE_FIELDS, GROUP_BY, groupTasks, inRange, isOverdue, validRange, weeklyTrend, type ReportTask } from "../domain/reports.js";

// Task reports API (spec Module 13, Task #13.1). Same visibility as the task list: managers and administrators see all
// tasks; employees see only their own. Reports are read-only.

export interface ReportDeps {
  tasks: TaskStore;
  directory: UserDirectory;
}

const query = z.object({
  groupBy: z.enum(GROUP_BY).default("status"),
  dateField: z.enum(DATE_FIELDS).default("dueDate"),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  archived: z.enum(["true", "false"]).default("false"),
});

const PAGE = 100;

async function visibleTasks(deps: ReportDeps, actor: Actor, archived: boolean): Promise<TaskRecord[]> {
  const all: TaskRecord[] = [];
  for (let page = 1; ; page++) {
    const { items, total } = await deps.tasks.list({
      archived,
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

export function taskReportHandler(deps: ReportDeps) {
  return async (req: Request, res: Response) => {
    try {
      const q = query.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const from = q.data.from ?? null;
      const to = q.data.to ?? null;
      if (!validRange(from, to)) {
        res.status(400).json({ error: "invalid-range" });
        return;
      }
      const session = res.locals.session as SessionRecord;
      const user = await deps.directory.findById(session.userId);
      if (!user || user.status !== "active") {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const actor: Actor = { id: user.id, roles: session.roles as readonly Role[], isDesignatedReviewer: user.isDesignatedReviewer };
      const today = localParts(new Date(), APP_TIMEZONE).date;
      const archived = q.data.archived === "true";
      const tasks = (await visibleTasks(deps, actor, archived)).filter((t) => inRange(t, q.data.dateField, from, to));
      const rows: ReportTask[] = tasks;

      const names = new Map((await deps.directory.list()).map((u) => [u.id, u.name]));
      const groups = groupTasks(rows, q.data.groupBy, today).map((g) => ({
        key: g.key,
        label: q.data.groupBy === "assignee" ? names.get(g.key) ?? "Former user" : g.key,
        count: g.count,
      }));

      // Trend: only when a range is given, so the weeks are bounded.
      const trend = from && to ? weeklyTrend(rows, from, to) : null;

      res.status(200).json({
        today,
        filters: { groupBy: q.data.groupBy, dateField: q.data.dateField, from, to, archived },
        total: rows.length,
        overdue: rows.filter((t) => isOverdue(t, today)).length,
        groups,
        trend,
      });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}
