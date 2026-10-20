import { randomBytes } from "node:crypto";
import { buildAuditRecord, type AuditInput, type AuditStore } from "../audit/audit.js";

// Planned allocation persistence (spec Module 8). applyChange writes the allocation, its change row,
// and the audit record together. The Prisma version uses one transaction; the in-memory version
// appends the audit record before it changes any state.

export interface AllocationRow {
  id: string;
  subjectId: string;
  plannedHours: number;
  updatedById: string;
  updatedAt: Date;
}

export interface ChangeRow {
  id: string;
  subjectId: string;
  previousHours: number;
  newHours: number;
  delta: number;
  reason: string | null;
  actorId: string;
  at: Date;
}

export class StaleAllocationError extends Error {
  constructor() {
    super("stale-allocation");
  }
}

export interface ApplyChangeInput {
  subjectId: string;
  // The value the caller read. null means no allocation row exists yet. A different current value
  // means someone else changed it first, so the change is refused.
  expectedPrevious: number | null;
  newHours: number;
  reason: string | null;
  actorId: string;
  audit: AuditInput;
}

export interface AllocationStore {
  list(): Promise<AllocationRow[]>;
  findBySubject(subjectId: string): Promise<AllocationRow | null>;
  history(subjectId: string): Promise<ChangeRow[]>;
  applyChange(input: ApplyChangeInput): Promise<{ allocation: AllocationRow; change: ChangeRow }>;
}

// Prototype and test store.
export class InMemoryAllocationStore implements AllocationStore {
  private readonly rows = new Map<string, AllocationRow>();
  private readonly changes: ChangeRow[] = [];

  constructor(private readonly audit: AuditStore) {}

  async list(): Promise<AllocationRow[]> {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  async findBySubject(subjectId: string): Promise<AllocationRow | null> {
    const row = this.rows.get(subjectId);
    return row ? { ...row } : null;
  }

  async history(subjectId: string): Promise<ChangeRow[]> {
    return this.changes.filter((c) => c.subjectId === subjectId).map((c) => ({ ...c }));
  }

  async applyChange(input: ApplyChangeInput): Promise<{ allocation: AllocationRow; change: ChangeRow }> {
    const current = this.rows.get(input.subjectId) ?? null;
    if ((current?.plannedHours ?? null) !== input.expectedPrevious) throw new StaleAllocationError();

    const previous = input.expectedPrevious ?? 0;
    const at = new Date();
    const change: ChangeRow = {
      id: randomBytes(16).toString("hex"),
      subjectId: input.subjectId,
      previousHours: previous,
      newHours: input.newHours,
      delta: Math.round((input.newHours - previous) * 100) / 100,
      reason: input.reason,
      actorId: input.actorId,
      at,
    };
    // Write the audit record first. If it fails, nothing below runs and no state changes.
    await this.audit.append(buildAuditRecord(input.audit));

    const allocation: AllocationRow = {
      id: current?.id ?? randomBytes(16).toString("hex"),
      subjectId: input.subjectId,
      plannedHours: input.newHours,
      updatedById: input.actorId,
      updatedAt: at,
    };
    this.rows.set(input.subjectId, allocation);
    this.changes.push(change);
    return { allocation: { ...allocation }, change: { ...change } };
  }
}
