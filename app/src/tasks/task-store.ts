import { randomBytes } from "node:crypto";

// Task persistence (spec Module 6). The Prisma implementation is in auth/prisma-stores.ts.

export interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  assigneeId: string;
  pmId: string;
  reviewerId: string;
  startDate: Date | null;
  dueDate: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
}

export type TaskSortField = "createdAt" | "dueDate" | "title" | "priority" | "status";

export interface TaskQuery {
  // Case-insensitive title search (Task #7.1).
  q?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  // Set for employees: only tasks assigned to this user.
  onlyAssigneeId?: string;
  archived: boolean;
  page: number;
  pageSize: number;
  sortBy: TaskSortField;
  sortDir: "asc" | "desc";
}

export interface NewTask {
  title: string;
  description: string | null;
  priority: string;
  status: string;
  assigneeId: string;
  pmId: string;
  reviewerId: string;
  startDate: Date | null;
  dueDate: Date | null;
}

export interface TaskPatch {
  title?: string;
  description?: string | null;
  priority?: string;
  assigneeId?: string;
  startDate?: Date | null;
  dueDate?: Date | null;
  archivedAt?: Date | null;
}

export interface StatusChange {
  taskId: string;
  fromStatus: string;
  toStatus: string;
  actorId: string;
}

export class StaleStatusError extends Error {
  constructor() {
    super("stale-status");
  }
}

export interface TaskStore {
  historyFor(taskId: string): Promise<TaskHistoryRow[]>;
  list(query: TaskQuery): Promise<{ items: TaskRecord[]; total: number }>;
  findById(id: string): Promise<TaskRecord | null>;
  create(input: NewTask): Promise<TaskRecord>;
  update(id: string, patch: TaskPatch): Promise<TaskRecord | null>;
  // Moves the task only if its status is still fromStatus, and writes the history row in the same step.
  // Throws StaleStatusError when another change moved it first.
  moveStatus(change: StatusChange): Promise<TaskRecord>;
}

const SORT_KEYS: Record<TaskSortField, (t: TaskRecord) => string | number> = {
  createdAt: (t) => t.createdAt.getTime(),
  dueDate: (t) => (t.dueDate ? t.dueDate.getTime() : Number.MAX_SAFE_INTEGER),
  title: (t) => t.title.toLowerCase(),
  priority: (t) => t.priority,
  status: (t) => t.status,
};

export interface TaskHistoryRow extends StatusChange {
  at: Date;
}

// Prototype and test store.
export class InMemoryTaskStore implements TaskStore {
  private readonly rows = new Map<string, TaskRecord>();
  readonly history: TaskHistoryRow[] = [];

  async historyFor(taskId: string): Promise<TaskHistoryRow[]> {
    return this.history.filter((h) => h.taskId === taskId).map((h) => ({ ...h }));
  }

  async list(query: TaskQuery): Promise<{ items: TaskRecord[]; total: number }> {
    let rows = [...this.rows.values()].filter((t) => (query.archived ? t.archivedAt !== null : t.archivedAt === null));
    if (query.q) rows = rows.filter((t) => t.title.toLowerCase().includes(query.q!.toLowerCase()));
    if (query.status) rows = rows.filter((t) => t.status === query.status);
    if (query.priority) rows = rows.filter((t) => t.priority === query.priority);
    if (query.assigneeId) rows = rows.filter((t) => t.assigneeId === query.assigneeId);
    if (query.onlyAssigneeId) rows = rows.filter((t) => t.assigneeId === query.onlyAssigneeId);
    const key = SORT_KEYS[query.sortBy];
    rows.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
      return query.sortDir === "asc" ? cmp : -cmp;
    });
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    return { items: rows.slice(start, start + query.pageSize).map(copy), total };
  }

  async findById(id: string): Promise<TaskRecord | null> {
    const row = this.rows.get(id);
    return row ? copy(row) : null;
  }

  async create(input: NewTask): Promise<TaskRecord> {
    const row: TaskRecord = { ...input, id: randomBytes(16).toString("hex"), archivedAt: null, createdAt: new Date() };
    this.rows.set(row.id, row);
    return copy(row);
  }

  async update(id: string, patch: TaskPatch): Promise<TaskRecord | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return copy(row);
  }

  async moveStatus(change: StatusChange): Promise<TaskRecord> {
    const row = this.rows.get(change.taskId);
    if (!row || row.status !== change.fromStatus) throw new StaleStatusError();
    row.status = change.toStatus;
    this.history.push({ ...change, at: new Date() });
    return copy(row);
  }
}

function copy(row: TaskRecord): TaskRecord {
  return { ...row };
}
