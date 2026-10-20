import { PrismaClient } from "@prisma/client";
import type { Role } from "../domain/roles.js";
import type { UserRecord, UserStore } from "../api/auth.js";
import type { SessionRecord, SessionStore } from "./session.js";
import type { ResetRecord, ResetStore, UserAdminStore } from "./reset.js";
import type { ApprovalStore, SubmissionRecord } from "../api/decisions.js";
import type { Decision } from "../domain/approval.js";
import { randomBytes } from "node:crypto";
import { DuplicateEmailError, type NewUser, type UserDirectory, type UserPatch, type UserView } from "./user-directory.js";
import type { AuditQuery, AuditReader, AuditRecord, AuditStore } from "../audit/audit.js";
import { buildAuditRecord } from "../audit/audit.js";
import { StaleAllocationError, type AllocationRow, type AllocationStore, type ApplyChangeInput, type ChangeRow } from "../allocation/allocation-store.js";
import { StaleStatusError, type TaskHistoryRow, type NewTask, type StatusChange, type TaskPatch, type TaskQuery, type TaskRecord, type TaskStore } from "../tasks/task-store.js";

// Database-backed stores for the Prisma schema (prisma/schema.prisma).
// Roles are stored in UserRole; the Session row carries no roles and reads them from the user.

export class PrismaUserStore implements UserStore {
  constructor(private readonly db: PrismaClient) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const user = await this.db.user.findUnique({
      where: { email },
      include: { roles: true },
    });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      roles: user.roles.map((r) => r.role as Role),
      status: user.status === "active" ? "active" : "deactivated",
      isDesignatedReviewer: user.isDesignatedReviewer,
    };
  }
}

export class PrismaUserAdminStore implements UserAdminStore {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string): Promise<{ id: string; roles: readonly Role[]; isDesignatedReviewer: boolean } | null> {
    const user = await this.db.user.findUnique({ where: { id }, include: { roles: true } });
    if (!user) return null;
    return {
      id: user.id,
      roles: user.roles.map((r) => r.role as Role),
      isDesignatedReviewer: user.isDesignatedReviewer,
    };
  }

  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db.user.update({ where: { id }, data: { passwordHash } });
  }

  async getPasswordHash(id: string): Promise<string | null> {
    const user = await this.db.user.findUnique({ where: { id }, select: { passwordHash: true } });
    return user?.passwordHash ?? null;
  }
}

export class PrismaSessionStore implements SessionStore {
  constructor(private readonly db: PrismaClient) {}

  async create(userId: string, roles: readonly Role[], ttlMinutes: number): Promise<SessionRecord> {
    const row = await this.db.session.create({
      data: {
        id: randomBytes(32).toString("base64url"),
        userId,
        csrfToken: randomBytes(32).toString("base64url"),
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
    });
    return {
      id: row.id,
      userId: row.userId,
      roles,
      csrfToken: row.csrfToken,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }

  async find(id: string): Promise<SessionRecord | null> {
    const row = await this.db.session.findUnique({
      where: { id },
      include: { user: { include: { roles: true } } },
    });
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return null;
    if (row.user.status !== "active") return null;
    return {
      id: row.id,
      userId: row.userId,
      roles: row.user.roles.map((r) => r.role as Role),
      csrfToken: row.csrfToken,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }

  async revoke(id: string): Promise<void> {
    await this.db.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

// Password reset rows (PasswordReset model). Only the token hash is stored.
export class PrismaResetStore implements ResetStore {
  constructor(private readonly db: PrismaClient) {}

  async create(record: Omit<ResetRecord, "id" | "usedAt">): Promise<ResetRecord> {
    const row = await this.db.passwordReset.create({
      data: {
        userId: record.userId,
        tokenHash: record.tokenHash,
        issuedById: record.issuedById,
        expiresAt: record.expiresAt,
      },
    });
    return { ...row };
  }

  async findByTokenHash(tokenHash: string): Promise<ResetRecord | null> {
    const row = await this.db.passwordReset.findFirst({ where: { tokenHash } });
    return row ? { ...row } : null;
  }

  async markUsed(id: string): Promise<void> {
    await this.db.passwordReset.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: new Date() },
    });
  }
}

// Approval submissions and decisions (ApprovalSubmission, ApprovalDecision). One decision per submission.
export class PrismaApprovalStore implements ApprovalStore {
  constructor(private readonly db: PrismaClient) {}

  async findSubmission(id: string): Promise<SubmissionRecord | null> {
    const row = await this.db.approvalSubmission.findUnique({
      where: { id },
      include: { task: true, decisions: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      taskId: row.taskId,
      submittedById: row.submittedById,
      reviewerId: row.task.reviewerId,
      alreadyDecided: row.decisions.length > 0,
    };
  }

  async recordDecision(submissionId: string, reviewerId: string, decision: Decision): Promise<void> {
    await this.db.approvalDecision.create({
      data: { submissionId, reviewerId, decision },
    });
  }
}

// User administration (Task #5.1). Roles are replaced as a set on update.
type UserRow = { id: string; name: string; email: string; status: string; isDesignatedReviewer: boolean; roles: { role: string }[] };

function toUserView(row: UserRow): UserView {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roles: row.roles.map((r) => r.role as Role),
    status: row.status === "active" ? "active" : "deactivated",
    isDesignatedReviewer: row.isDesignatedReviewer,
  };
}

export class PrismaUserDirectory implements UserDirectory {
  constructor(private readonly db: PrismaClient) {}

  async list(): Promise<UserView[]> {
    const rows = await this.db.user.findMany({ include: { roles: true }, orderBy: { createdAt: "asc" } });
    return rows.map(toUserView);
  }

  async findById(id: string): Promise<UserView | null> {
    const row = await this.db.user.findUnique({ where: { id }, include: { roles: true } });
    return row ? toUserView(row) : null;
  }

  async create(input: NewUser): Promise<UserView> {
    try {
      const row = await this.db.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: input.passwordHash,
          roles: { create: input.roles.map((role) => ({ role })) },
        },
        include: { roles: true },
      });
      return toUserView(row);
    } catch (err) {
      // Prisma unique constraint violation on User.email
      if ((err as { code?: string }).code === "P2002") throw new DuplicateEmailError();
      throw err;
    }
  }

  async update(id: string, patch: UserPatch): Promise<UserView | null> {
    const exists = await this.db.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return null;
    const row = await this.db.user.update({
      where: { id },
      data: {
        name: patch.name,
        status: patch.status,
        roles: patch.roles ? { deleteMany: {}, create: patch.roles.map((role) => ({ role })) } : undefined,
      },
      include: { roles: true },
    });
    return toUserView(row);
  }
}

// Tasks (Task #6.1 to #6.3). Status moves run in one transaction: the update only applies if the
// status is still the expected one, and the history row is written in the same step.
type TaskRow = {
  id: string; title: string; description: string | null; priority: string; status: string;
  assigneeId: string; pmId: string; reviewerId: string; startDate: Date | null; dueDate: Date | null;
  archivedAt: Date | null; createdAt: Date;
};

function toTaskRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id, title: row.title, description: row.description, priority: row.priority, status: row.status,
    assigneeId: row.assigneeId, pmId: row.pmId, reviewerId: row.reviewerId, startDate: row.startDate,
    dueDate: row.dueDate, archivedAt: row.archivedAt, createdAt: row.createdAt,
  };
}

export class PrismaTaskStore implements TaskStore {
  constructor(private readonly db: PrismaClient) {}

  async list(query: TaskQuery): Promise<{ items: TaskRecord[]; total: number }> {
    const where = {
      archivedAt: query.archived ? { not: null } : null,
      title: query.q ? { contains: query.q, mode: "insensitive" as const } : undefined,
      status: query.status,
      priority: query.priority,
      assigneeId: query.onlyAssigneeId ?? query.assigneeId,
    };
    const orderBy =
      query.sortBy === "dueDate"
        ? { dueDate: { sort: query.sortDir, nulls: "last" as const } }
        : { [query.sortBy]: query.sortDir };
    const [rows, total] = await Promise.all([
      this.db.task.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.db.task.count({ where }),
    ]);
    return { items: rows.map(toTaskRecord), total };
  }

  async findById(id: string): Promise<TaskRecord | null> {
    const row = await this.db.task.findUnique({ where: { id } });
    return row ? toTaskRecord(row) : null;
  }

  async create(input: NewTask): Promise<TaskRecord> {
    const row = await this.db.task.create({ data: input });
    return toTaskRecord(row);
  }

  async update(id: string, patch: TaskPatch): Promise<TaskRecord | null> {
    const exists = await this.db.task.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return null;
    const row = await this.db.task.update({ where: { id }, data: patch });
    return toTaskRecord(row);
  }

  async historyFor(taskId: string): Promise<TaskHistoryRow[]> {
    const rows = await this.db.taskStatusHistory.findMany({ where: { taskId }, orderBy: { at: "desc" } });
    return rows.map((r) => ({ taskId: r.taskId, fromStatus: r.fromStatus ?? "", toStatus: r.toStatus, actorId: r.actorId, at: r.at }));
  }

  async moveStatus(change: StatusChange): Promise<TaskRecord> {
    return this.db.$transaction(async (tx) => {
      const moved = await tx.task.updateMany({
        where: { id: change.taskId, status: change.fromStatus },
        data: { status: change.toStatus },
      });
      if (moved.count !== 1) throw new StaleStatusError();
      await tx.taskStatusHistory.create({
        data: {
          taskId: change.taskId,
          fromStatus: change.fromStatus,
          toStatus: change.toStatus,
          actorId: change.actorId,
        },
      });
      const row = await tx.task.findUniqueOrThrow({ where: { id: change.taskId } });
      return toTaskRecord(row);
    });
  }
}

// Audit records (Task #9.1). Insert only: the database refuses UPDATE, DELETE, and TRUNCATE.
export class PrismaAuditStore implements AuditStore, AuditReader {
  constructor(private readonly db: PrismaClient) {}

  async query(query: AuditQuery): Promise<{ items: AuditRecord[]; total: number }> {
    const where = { entityType: query.entityType, action: query.action, actorId: query.actorId };
    const [rows, total] = await Promise.all([
      this.db.auditEvent.findMany({ where, orderBy: { at: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.db.auditEvent.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({ id: r.id, at: r.at, actorId: r.actorId, action: r.action, entityType: r.entityType, entityId: r.entityId, payload: r.payload as Record<string, unknown> })),
      total,
    };
  }

  async append(record: AuditRecord): Promise<void> {
    await this.db.auditEvent.create({
      data: {
        id: record.id,
        actorId: record.actorId,
        action: record.action,
        entityType: record.entityType,
        entityId: record.entityId,
        payload: record.payload as object,
        at: record.at,
      },
    });
  }
}

// Planned allocation (Module 8). applyChange is one transaction: the allocation update only applies if the
// stored value is still the expected one, and the change row and audit record are written in the same step.
const toHours = (value: unknown): number => Number(String(value));

export class PrismaAllocationStore implements AllocationStore {
  constructor(private readonly db: PrismaClient) {}

  async list(): Promise<AllocationRow[]> {
    const rows = await this.db.allocation.findMany();
    return rows.map((r) => ({ id: r.id, subjectId: r.subjectId, plannedHours: toHours(r.plannedHours), updatedById: r.updatedById, updatedAt: r.updatedAt }));
  }

  async findBySubject(subjectId: string): Promise<AllocationRow | null> {
    const r = await this.db.allocation.findUnique({ where: { subjectId } });
    return r ? { id: r.id, subjectId: r.subjectId, plannedHours: toHours(r.plannedHours), updatedById: r.updatedById, updatedAt: r.updatedAt } : null;
  }

  async history(subjectId: string): Promise<ChangeRow[]> {
    const rows = await this.db.allocationChange.findMany({
      where: { allocation: { subjectId } },
      orderBy: { at: "desc" },
    });
    return rows.map((c) => ({
      id: c.id,
      subjectId,
      previousHours: toHours(c.previousHours),
      newHours: toHours(c.newHours),
      delta: toHours(c.delta),
      reason: c.reason,
      actorId: c.actorId,
      at: c.at,
    }));
  }

  async applyChange(input: ApplyChangeInput): Promise<{ allocation: AllocationRow; change: ChangeRow }> {
    return this.db.$transaction(async (tx) => {
      const previous = input.expectedPrevious ?? 0;
      const delta = Math.round((input.newHours - previous) * 100) / 100;
      let row;
      if (input.expectedPrevious === null) {
        try {
          row = await tx.allocation.create({
            data: { subjectId: input.subjectId, plannedHours: input.newHours.toFixed(2), updatedById: input.actorId },
          });
        } catch (err) {
          // Another request created the row first (unique subjectId).
          if ((err as { code?: string }).code === "P2002") throw new StaleAllocationError();
          throw err;
        }
      } else {
        const moved = await tx.allocation.updateMany({
          where: { subjectId: input.subjectId, plannedHours: previous.toFixed(2) },
          data: { plannedHours: input.newHours.toFixed(2), updatedById: input.actorId },
        });
        if (moved.count !== 1) throw new StaleAllocationError();
        row = await tx.allocation.findUniqueOrThrow({ where: { subjectId: input.subjectId } });
      }
      const change = await tx.allocationChange.create({
        data: {
          allocationId: row.id,
          previousHours: previous.toFixed(2),
          newHours: input.newHours.toFixed(2),
          delta: delta.toFixed(2),
          reason: input.reason,
          actorId: input.actorId,
        },
      });
      const audit = buildAuditRecord(input.audit);
      await tx.auditEvent.create({
        data: {
          id: audit.id,
          actorId: audit.actorId,
          action: audit.action,
          entityType: audit.entityType,
          entityId: audit.entityId,
          payload: audit.payload as object,
          at: audit.at,
        },
      });
      return {
        allocation: { id: row.id, subjectId: row.subjectId, plannedHours: toHours(row.plannedHours), updatedById: row.updatedById, updatedAt: row.updatedAt },
        change: {
          id: change.id,
          subjectId: input.subjectId,
          previousHours: previous,
          newHours: input.newHours,
          delta,
          reason: change.reason,
          actorId: change.actorId,
          at: change.at,
        },
      };
    });
  }
}
