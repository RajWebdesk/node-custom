import { TASK_STATUSES } from "./tasks.js";

// Task list rules (Task #13.3, pilot decision 2026-10-21). Pure functions, no I/O.
// The built-in statuses (TASK_STATUSES) are protected: they cannot be removed, renamed or duplicated.
// Administrators may add extra free statuses, and may change the priority list. A value that a task still uses
// cannot be removed, so no task is left with a status or priority that no longer exists.

export const LIST_LIMITS = { extraStatuses: 20, priorities: 10, valueLength: 40 } as const;

export type ListKind = "status" | "priority";

export interface ListsUpdate {
  statuses: string[]; // extra statuses only; built-in statuses are not sent
  priorities: string[];
}

export interface TaskUsage {
  status: Record<string, number>;
  priority: Record<string, number>;
}

export type ListsValidation =
  | { ok: true; statuses: string[]; priorities: string[] }
  | { ok: false; error: "invalid-value" | "duplicate-value" | "protected-status" | "in-use" | "too-many" | "priority-required"; value?: string; kind?: ListKind };

const protectedKeys = new Set(TASK_STATUSES.map((s) => s.toLowerCase()));

// Trims and checks one list. Duplicates and protected names are compared ignoring case.
function normalise(kind: ListKind, values: string[]): { values: string[] } | { error: ListsValidation } {
  const max = kind === "status" ? LIST_LIMITS.extraStatuses : LIST_LIMITS.priorities;
  if (values.length > max) return { error: { ok: false, error: "too-many", kind } };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length === 0 || value.length > LIST_LIMITS.valueLength) {
      return { error: { ok: false, error: "invalid-value", value: String(raw), kind } };
    }
    const key = value.toLowerCase();
    if (kind === "status" && protectedKeys.has(key)) {
      return { error: { ok: false, error: "protected-status", value, kind } };
    }
    if (seen.has(key)) return { error: { ok: false, error: "duplicate-value", value, kind } };
    seen.add(key);
    out.push(value);
  }
  return { values: out };
}

// current: the extra statuses and priorities now stored. usage: how many tasks use each value.
export function validateListsUpdate(
  input: ListsUpdate,
  current: { statuses: string[]; priorities: string[] },
  usage: TaskUsage,
): ListsValidation {
  const statuses = normalise("status", input.statuses);
  if ("error" in statuses) return statuses.error;
  const priorities = normalise("priority", input.priorities);
  if ("error" in priorities) return priorities.error;
  if (priorities.values.length === 0) return { ok: false, error: "priority-required" };

  const removed: [ListKind, string[], Record<string, number>][] = [
    ["status", current.statuses.filter((v) => !statuses.values.includes(v)), usage.status],
    ["priority", current.priorities.filter((v) => !priorities.values.includes(v)), usage.priority],
  ];
  for (const [kind, values, counts] of removed) {
    for (const value of values) {
      if ((counts[value] ?? 0) > 0) return { ok: false, error: "in-use", value, kind };
    }
  }
  return { ok: true, statuses: statuses.values, priorities: priorities.values };
}
