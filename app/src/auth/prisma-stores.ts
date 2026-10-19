import { PrismaClient } from "@prisma/client";
import type { Role } from "../domain/roles.js";
import type { UserRecord, UserStore } from "../api/auth.js";
import type { SessionRecord, SessionStore } from "./session.js";
import type { ResetRecord, ResetStore, UserAdminStore } from "./reset.js";
import type { ApprovalStore, SubmissionRecord } from "../api/decisions.js";
import type { Decision } from "../domain/approval.js";
import { randomBytes } from "node:crypto";

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
