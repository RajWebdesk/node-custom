import { buildAuditRecord, type AuditInput, type AuditStore } from "../audit/audit.js";
import type { Decision } from "../domain/approval.js";
import type { TaskStore } from "../tasks/task-store.js";
import type { NewNotification, NotificationStore } from "../notifications/notification-store.js";

// Submissions and decisions (spec Module 10, Task #10.1). Each write is one step: the submission or decision,
// the task status change (when there is one), its history row, and the audit record.
// The Prisma version uses one transaction; the in-memory version checks every condition before it changes state.

export interface SubmissionRecord {
  id: string;
  taskId: string;
  submittedById: string;
  submittedAt: Date;
  revisionNo: number;
  // The task's designated reviewer at read time.
  reviewerId: string;
  decision: Decision | null;
  decidedById: string | null;
  decidedAt: Date | null;
}

export interface QueueRow {
  submissionId: string;
  taskId: string;
  submittedById: string;
  revisionNo: number;
  submittedAt: Date;
}

// The decision for this submission is already recorded (one decision per submission).
export class DuplicateDecisionError extends Error {
  constructor() {
    super("already-decided");
  }
}

// The task changed status since it was read (another change or decision landed first).
export class StaleApprovalError extends Error {
  constructor() {
    super("stale-approval");
  }
}

export interface SubmitInput {
  submissionId: string;
  taskId: string;
  submittedById: string;
  // Status the task had when it was read. The change applies only if it is still this status.
  fromStatus: string;
  // null means the task status does not change (resubmission after a rejection, already In Review).
  toStatus: string | null;
  audit: AuditInput;
  notifications: NewNotification[];
}

export interface DecideInput {
  submissionId: string;
  decidedById: string;
  decision: Decision;
  // Always In Review: a decision is accepted only while the task is in review.
  fromStatus: string;
  // null for reject (no status change).
  toStatus: string | null;
  audit: AuditInput;
  notifications: NewNotification[];
}

export interface ApprovalStore {
  findSubmission(id: string): Promise<SubmissionRecord | null>;
  listForTask(taskId: string): Promise<SubmissionRecord[]>;
  listPendingFor(reviewerId: string): Promise<QueueRow[]>;
  submit(input: SubmitInput, actorId: string): Promise<SubmissionRecord>;
  decide(input: DecideInput): Promise<SubmissionRecord>;
}

// Prototype and test store. Takes the task store so that status changes apply in the same call.
export class InMemoryApprovalStore implements ApprovalStore {
  private readonly rows = new Map<string, SubmissionRecord>();

  constructor(
    private readonly tasks: TaskStore,
    private readonly audit: AuditStore,
    private readonly notifications: NotificationStore,
  ) {}

  private async view(row: SubmissionRecord): Promise<SubmissionRecord> {
    const task = await this.tasks.findById(row.taskId);
    return { ...row, reviewerId: task?.reviewerId ?? row.reviewerId };
  }

  async findSubmission(id: string): Promise<SubmissionRecord | null> {
    const row = this.rows.get(id);
    return row ? this.view(row) : null;
  }

  async listForTask(taskId: string): Promise<SubmissionRecord[]> {
    const rows = [...this.rows.values()].filter((r) => r.taskId === taskId).sort((a, b) => a.revisionNo - b.revisionNo);
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async listPendingFor(reviewerId: string): Promise<QueueRow[]> {
    const out: QueueRow[] = [];
    for (const row of this.rows.values()) {
      if (row.decision !== null) continue;
      const task = await this.tasks.findById(row.taskId);
      if (task && task.reviewerId === reviewerId && task.status === "In Review" && task.archivedAt === null) {
        out.push({
          submissionId: row.id,
          taskId: row.taskId,
          submittedById: row.submittedById,
          revisionNo: row.revisionNo,
          submittedAt: row.submittedAt,
        });
      }
    }
    return out;
  }

  async submit(input: SubmitInput, actorId: string): Promise<SubmissionRecord> {
    const latest = [...this.rows.values()].filter((r) => r.taskId === input.taskId).reduce((max, r) => Math.max(max, r.revisionNo), 0);
    const task = await this.tasks.findById(input.taskId);
    if (!task || task.status !== input.fromStatus) throw new StaleApprovalError();

    const at = new Date();
    const row: SubmissionRecord = {
      id: input.submissionId,
      taskId: input.taskId,
      submittedById: input.submittedById,
      submittedAt: at,
      revisionNo: latest + 1,
      reviewerId: task.reviewerId,
      decision: null,
      decidedById: null,
      decidedAt: null,
    };
    // Audit first: if it fails, nothing below runs.
    await this.audit.append(buildAuditRecord(input.audit));
    this.notifications.add(input.notifications);
    if (input.toStatus !== null) {
      await this.tasks.moveStatus({ taskId: input.taskId, fromStatus: input.fromStatus, toStatus: input.toStatus, actorId });
    }
    this.rows.set(row.id, row);
    return { ...row };
  }

  async decide(input: DecideInput): Promise<SubmissionRecord> {
    const row = this.rows.get(input.submissionId);
    if (!row) throw new StaleApprovalError();
    if (row.decision !== null) throw new DuplicateDecisionError();
    const task = await this.tasks.findById(row.taskId);
    if (!task || task.status !== input.fromStatus) throw new StaleApprovalError();

    await this.audit.append(buildAuditRecord(input.audit));
    this.notifications.add(input.notifications);
    if (input.toStatus !== null) {
      await this.tasks.moveStatus({ taskId: row.taskId, fromStatus: input.fromStatus, toStatus: input.toStatus, actorId: input.decidedById });
    }
    row.decision = input.decision;
    row.decidedById = input.decidedById;
    row.decidedAt = new Date();
    return this.view(row);
  }
}
