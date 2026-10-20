import type { Actor } from "./roles.js";

// Task rules (spec Module 6, Task #6.3). Pure functions, no I/O.
//
// PLACEHOLDER: the spec does not define the status and priority lists. These are interim values,
// confirmed by the project owner for Sprint 3 development only. Change them here and in the records
// when the client confirms the lists.

export const TASK_STATUSES = ["To Do", "In Progress", "In Review", "Approved", "Revision requested"] as const; // PLACEHOLDER
export const TASK_PRIORITIES = ["Low", "Medium", "High"] as const; // PLACEHOLDER

export type TaskStatus = (typeof TASK_STATUSES)[number];

// Statuses that only the approval workflow (Module 10) may set. A plain move, including a Kanban move,
// can never reach them or leave them. This is the "avoid bypassing approval via Kanban" rule.
export const WORKFLOW_STATUSES: readonly TaskStatus[] = ["In Review", "Approved", "Revision requested"];

// Statuses a manager or administrator can move between directly.
export const FREE_STATUSES: readonly TaskStatus[] = ["To Do", "In Progress"];

export type MoveResult =
  | { ok: true }
  | { ok: false; reason: "unknown-status" | "same-status" | "workflow-controlled" | "archived" };

export function canMoveTask(from: string, to: string, archived: boolean): MoveResult {
  if (archived) return { ok: false, reason: "archived" };
  if (!(TASK_STATUSES as readonly string[]).includes(to)) return { ok: false, reason: "unknown-status" };
  if (from === to) return { ok: false, reason: "same-status" };
  if (WORKFLOW_STATUSES.includes(to as TaskStatus) || WORKFLOW_STATUSES.includes(from as TaskStatus)) {
    return { ok: false, reason: "workflow-controlled" };
  }
  return { ok: true };
}

// Administrators and Managers view and edit all tasks (sow-spec role matrix).
// Employees view only the tasks assigned to them and cannot create or edit tasks.
export function canManageTasks(actor: Actor): boolean {
  return actor.roles.includes("ADMINISTRATOR") || actor.roles.includes("MANAGER");
}

export function canSeeTask(actor: Actor, task: { assigneeId: string }): boolean {
  return canManageTasks(actor) || task.assigneeId === actor.id;
}
