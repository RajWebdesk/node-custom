import { buildAuditRecord, type AuditInput, type AuditStore } from "../audit/audit.js";
import type { ListsUpdate, TaskUsage } from "../domain/task-lists.js";

// Stored task lists (Task #13.3). The built-in statuses are not stored; they are protected in code.
// The Prisma implementation is in auth/prisma-stores.ts.

export interface TaskListSnapshot {
  statuses: string[]; // extra statuses, in order
  priorities: string[]; // priorities, in order
}

export interface TaskListStore {
  read(): Promise<TaskListSnapshot>;
  usage(): Promise<TaskUsage>;
  // Replaces the extra statuses and the priorities, and writes the audit record in the same step.
  write(next: ListsUpdate, audit: Omit<AuditInput, "entityType" | "entityId">): Promise<TaskListSnapshot>;
}

export const DEFAULT_PRIORITIES = ["Low", "Medium", "High"];

// Counts how many rows use each status and priority.
export function countUsage(rows: { status: string; priority: string }[]): TaskUsage {
  const usage: TaskUsage = { status: {}, priority: {} };
  for (const r of rows) {
    usage.status[r.status] = (usage.status[r.status] ?? 0) + 1;
    usage.priority[r.priority] = (usage.priority[r.priority] ?? 0) + 1;
  }
  return usage;
}

// Prototype and test store.
export class InMemoryTaskListStore implements TaskListStore {
  private snapshot: TaskListSnapshot = { statuses: [], priorities: [...DEFAULT_PRIORITIES] };

  // usageFrom reports how many tasks use each value; the app passes the task store's counts.
  constructor(private readonly audit?: AuditStore, private readonly usageFrom?: () => Promise<TaskUsage>) {}

  async read(): Promise<TaskListSnapshot> {
    return { statuses: [...this.snapshot.statuses], priorities: [...this.snapshot.priorities] };
  }

  async usage(): Promise<TaskUsage> {
    return this.usageFrom ? this.usageFrom() : { status: {}, priority: {} };
  }

  async write(next: ListsUpdate, audit: Omit<AuditInput, "entityType" | "entityId">): Promise<TaskListSnapshot> {
    this.snapshot = { statuses: [...next.statuses], priorities: [...next.priorities] };
    if (this.audit) await this.audit.append(buildAuditRecord({ ...audit, entityType: "TaskList", entityId: "task-lists" }));
    return this.read();
  }
}
