import { describe, expect, it } from "vitest";
import { canManageTasks, canMoveTask, canSeeTask, FREE_STATUSES, TASK_STATUSES, WORKFLOW_STATUSES } from "./tasks.js";
import type { Actor } from "./roles.js";

// Task #7.4: lifecycle and access rules, checked as a full table rather than sample cases.

const admin: Actor = { id: "a", roles: ["ADMINISTRATOR"], isDesignatedReviewer: false };
const manager: Actor = { id: "m", roles: ["MANAGER"], isDesignatedReviewer: false };
const employee: Actor = { id: "e", roles: ["EMPLOYEE"], isDesignatedReviewer: false };

describe("task status transitions (Task #6.3, #7.4)", () => {
  it("allows only moves between the two free statuses on an unarchived task", () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        const result = canMoveTask(from, to, false);
        const freeMove = FREE_STATUSES.includes(from as never) && FREE_STATUSES.includes(to as never) && from !== to;
        if (freeMove) {
          expect(result).toEqual({ ok: true });
        } else {
          expect(result.ok).toBe(false);
        }
      }
    }
  });

  it("never allows a move into or out of an approval-controlled status", () => {
    for (const workflow of WORKFLOW_STATUSES) {
      for (const other of TASK_STATUSES) {
        if (other === workflow) continue;
        expect(canMoveTask(other, workflow, false)).toEqual({ ok: false, reason: "workflow-controlled" });
        expect(canMoveTask(workflow, other, false)).toEqual({ ok: false, reason: "workflow-controlled" });
      }
    }
  });

  it("refuses every move on an archived task, whatever the status", () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        expect(canMoveTask(from, to, true)).toEqual({ ok: false, reason: "archived" });
      }
    }
  });

  it("refuses an unknown target status and a same-status move", () => {
    expect(canMoveTask("To Do", "Shipped", false)).toEqual({ ok: false, reason: "unknown-status" });
    expect(canMoveTask("In Progress", "In Progress", false)).toEqual({ ok: false, reason: "same-status" });
  });
});

describe("task access (Task #6.2, #7.4)", () => {
  const task = { assigneeId: "e" };

  it("lets administrators and managers manage and see any task", () => {
    expect(canManageTasks(admin)).toBe(true);
    expect(canManageTasks(manager)).toBe(true);
    expect(canSeeTask(admin, { assigneeId: "someone-else" })).toBe(true);
    expect(canSeeTask(manager, { assigneeId: "someone-else" })).toBe(true);
  });

  it("lets an employee manage nothing and see only their own assignments", () => {
    expect(canManageTasks(employee)).toBe(false);
    expect(canSeeTask(employee, task)).toBe(true);
    expect(canSeeTask(employee, { assigneeId: "someone-else" })).toBe(false);
  });
});
