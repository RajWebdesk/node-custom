import type { Actor } from "./roles.js";
import { canManageTasks } from "./tasks.js";
import type { Decision } from "./approval.js";

// Submission and revision rules (spec Module 10, Tasks #10.2 and #10.4). Pure functions, no I/O.
// Rejection adds no status: the task stays In Review. A task can be submitted from any free status
// (the built-in ones or an administrator-added one) and from Revision requested.

export const SUBMITTABLE_FROM = ["To Do", "In Progress", "Revision requested"] as const;

export type SubmitResult =
  | { ok: true; changesStatus: boolean }
  | { ok: false; reason: "archived" | "already-in-review" | "not-submittable" | "forbidden" };

// The assignee submits their own task. Managers and administrators may submit on their behalf.
export function canSubmitTask(actor: Actor, task: { assigneeId: string }): boolean {
  return actor.id === task.assigneeId || canManageTasks(actor);
}

// lastDecision is the decision on the latest submission, or null when there is none.
// After a rejection the task stays In Review with no open submission, so a new submission is allowed.
// That follow-up is not defined in the spec (open edge case, recorded in the traceability document).
export function canSubmit(input: {
  status: string;
  archived: boolean;
  lastDecision: Decision | null;
  freeStatuses?: readonly string[];
}): SubmitResult {
  if (input.archived) return { ok: false, reason: "archived" };
  const free = input.freeStatuses ?? SUBMITTABLE_FROM;
  if (free.includes(input.status) || input.status === "Revision requested") return { ok: true, changesStatus: true };
  if (input.status === "In Review") {
    return input.lastDecision === "reject"
      ? { ok: true, changesStatus: false }
      : { ok: false, reason: "already-in-review" };
  }
  return { ok: false, reason: "not-submittable" };
}

// The task status a decision moves the task to. Reject leaves the task In Review (null means no status change).
export function statusAfterDecision(decision: Decision): string | null {
  if (decision === "approve") return "Approved";
  if (decision === "revise") return "Revision requested";
  return null;
}
