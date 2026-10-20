import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { UserDirectory } from "../auth/user-directory.js";
import type { SessionRecord } from "../auth/session.js";
import { canManageTasks, canMoveTask, canSeeTask, TASK_PRIORITIES, TASK_STATUSES } from "../domain/tasks.js";
import type { Actor, Role } from "../domain/roles.js";
import { StaleStatusError, type TaskRecord, type TaskStore } from "../tasks/task-store.js";
import { recordAudit, type AuditStore } from "../audit/audit.js";

// Task API (spec Module 6). Rules live in domain/tasks.ts. This file loads records, checks access,
// validates input, and returns the result. Employees see only their own tasks and cannot change them.

export interface TasksDeps {
  tasks: TaskStore;
  directory: UserDirectory;
  audit: AuditStore;
}

const taskIdParams = z.object({ taskId: z.string().min(1).max(64) });

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeId: z.string().min(1).max(64).optional(),
  archived: z.enum(["true", "false"]).default("false"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(["createdAt", "dueDate", "title", "priority", "status"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

const dateString = z.string().datetime().nullable();

const createBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).nullable().optional(),
    priority: z.enum(TASK_PRIORITIES),
    assigneeId: z.string().min(1).max(64),
    reviewerId: z.string().min(1).max(64),
    startDate: dateString.optional(),
    dueDate: dateString.optional(),
  })
  .strict();

// Reviewer is set at creation only. Changing it mid-review is out of scope for this slice.
const patchBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    assigneeId: z.string().min(1).max(64).optional(),
    startDate: dateString.optional(),
    dueDate: dateString.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "empty-patch" });

const statusBody = z.object({ status: z.enum(TASK_STATUSES) }).strict();

function actorOf(res: Response): Actor {
  const session = res.locals.session as SessionRecord;
  return { id: session.userId, roles: session.roles as readonly Role[], isDesignatedReviewer: false };
}

// Users a manager can pick as assignee or reviewer (Task #7.2). Active accounts only; no email addresses.
export function listAssignableUsersHandler(deps: TasksDeps) {
  return async (_req: Request, res: Response) => {
    try {
      const users = await deps.directory.list();
      const items = users
        .filter((u) => u.status === "active")
        .map((u) => ({ id: u.id, name: u.name, isDesignatedReviewer: u.isDesignatedReviewer }));
      res.status(200).json({ users: items });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

// Only Administrators and Managers create, edit, archive, or move tasks.
export function requireTaskManager(req: Request, res: Response, next: NextFunction): void {
  if (!canManageTasks(actorOf(res))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

async function assigneeIsActive(directory: UserDirectory, id: string): Promise<boolean> {
  const user = await directory.findById(id);
  return user !== null && user.status === "active";
}

async function reviewerIsValid(directory: UserDirectory, id: string): Promise<boolean> {
  const user = await directory.findById(id);
  return user !== null && user.status === "active" && user.isDesignatedReviewer;
}

function datesInOrder(start: Date | null | undefined, due: Date | null | undefined): boolean {
  return !(start && due && due.getTime() < start.getTime());
}

function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

export function listTasksHandler(deps: TasksDeps) {
  return async (req: Request, res: Response) => {
    try {
      const q = listQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const actor = actorOf(res);
      const { items, total } = await deps.tasks.list({
        q: q.data.q || undefined,
        status: q.data.status,
        priority: q.data.priority,
        assigneeId: q.data.assigneeId,
        onlyAssigneeId: canManageTasks(actor) ? undefined : actor.id,
        archived: q.data.archived === "true",
        page: q.data.page,
        pageSize: q.data.pageSize,
        sortBy: q.data.sortBy,
        sortDir: q.data.sortDir,
      });
      res.status(200).json({ items, total, page: q.data.page, pageSize: q.data.pageSize });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

export function getTaskHandler(deps: TasksDeps) {
  return async (req: Request, res: Response) => {
    try {
      const p = taskIdParams.safeParse(req.params);
      if (!p.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const task = await deps.tasks.findById(p.data.taskId);
      // Hidden tasks return not-found, so an employee cannot learn that another task exists.
      if (!task || !canSeeTask(actorOf(res), task)) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      res.status(200).json(task);
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

export function createTaskHandler(deps: TasksDeps) {
  return async (req: Request, res: Response) => {
    try {
      const body = createBody.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const b = body.data;
      const startDate = toDate(b.startDate);
      const dueDate = toDate(b.dueDate);
      if (!datesInOrder(startDate, dueDate)) {
        res.status(400).json({ error: "invalid-dates" });
        return;
      }
      if (!(await assigneeIsActive(deps.directory, b.assigneeId))) {
        res.status(400).json({ error: "invalid-assignee" });
        return;
      }
      if (!(await reviewerIsValid(deps.directory, b.reviewerId))) {
        res.status(400).json({ error: "invalid-reviewer" });
        return;
      }
      const task = await deps.tasks.create({
        title: b.title,
        description: b.description ?? null,
        priority: b.priority,
        status: "To Do",
        assigneeId: b.assigneeId,
        pmId: actorOf(res).id,
        reviewerId: b.reviewerId,
        startDate: startDate ?? null,
        dueDate: dueDate ?? null,
      });
      await recordAudit(deps.audit, {
        actorId: actorOf(res).id,
        action: "task.created",
        entityType: "Task",
        entityId: task.id,
        payload: { title: task.title, priority: task.priority, assigneeId: task.assigneeId, reviewerId: task.reviewerId },
      });
      res.status(201).json(task);
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

// Editing is refused for archived tasks, except unarchiving. Status moves are a separate endpoint.
export function updateTaskHandler(deps: TasksDeps) {
  return async (req: Request, res: Response) => {
    try {
      const p = taskIdParams.safeParse(req.params);
      const body = patchBody.safeParse(req.body);
      if (!p.success || !body.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const current = await deps.tasks.findById(p.data.taskId);
      if (!current) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const b = body.data;
      const onlyUnarchive = Object.keys(b).length === 1 && b.archived === false;
      if (current.archivedAt && !onlyUnarchive) {
        res.status(409).json({ error: "archived" });
        return;
      }
      const startDate = toDate(b.startDate);
      const dueDate = toDate(b.dueDate);
      if (!datesInOrder(startDate === undefined ? current.startDate : startDate, dueDate === undefined ? current.dueDate : dueDate)) {
        res.status(400).json({ error: "invalid-dates" });
        return;
      }
      if (b.assigneeId !== undefined && !(await assigneeIsActive(deps.directory, b.assigneeId))) {
        res.status(400).json({ error: "invalid-assignee" });
        return;
      }
      const updated = await deps.tasks.update(current.id, {
        title: b.title,
        description: b.description,
        priority: b.priority,
        assigneeId: b.assigneeId,
        startDate,
        dueDate,
        archivedAt: b.archived === undefined ? undefined : b.archived ? new Date() : null,
      });
      if (updated) {
        await recordAudit(deps.audit, {
          actorId: actorOf(res).id,
          action: b.archived === true ? "task.archived" : b.archived === false ? "task.restored" : "task.updated",
          entityType: "Task",
          entityId: updated.id,
          payload: { changes: b },
        });
      }
      res.status(200).json(updated);
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

// Kanban moves and manual status changes call the same transition check (Task #6.3).
export function moveTaskStatusHandler(deps: TasksDeps) {
  return async (req: Request, res: Response) => {
    try {
      const p = taskIdParams.safeParse(req.params);
      const body = statusBody.safeParse(req.body);
      if (!p.success || !body.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const task = await deps.tasks.findById(p.data.taskId);
      if (!task) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const actor = actorOf(res);
      if (!canSeeTask(actor, task)) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      if (!canManageTasks(actor)) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const check = canMoveTask(task.status, body.data.status, task.archivedAt !== null);
      if (!check.ok) {
        res.status(check.reason === "unknown-status" ? 400 : 409).json({ error: check.reason });
        return;
      }
      try {
        const moved: TaskRecord = await deps.tasks.moveStatus({
          taskId: task.id,
          fromStatus: task.status,
          toStatus: body.data.status,
          actorId: actor.id,
        });
        await recordAudit(deps.audit, {
          actorId: actor.id,
          action: "task.status_changed",
          entityType: "Task",
          entityId: task.id,
          payload: { from: task.status, to: body.data.status },
        });
        res.status(200).json(moved);
      } catch (err) {
        if (err instanceof StaleStatusError) {
          res.status(409).json({ error: "stale-status" });
          return;
        }
        throw err;
      }
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}
