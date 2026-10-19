import { createHash, randomBytes } from "node:crypto";
import type { Role } from "../domain/roles.js";

// Administrator-assisted password reset (spec Task #4.3). No self-service reset, no email delivery.
// The administrator issues a one-time token, which is shown once and stored only as a hash.
// Expiry of 60 minutes is a technical default (draft), not an approved decision.

export const RESET_TTL_MINUTES = 60;

export interface ResetRecord {
  id: string;
  userId: string;
  tokenHash: string;
  issuedById: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface ResetStore {
  create(record: Omit<ResetRecord, "id" | "usedAt">): Promise<ResetRecord>;
  findByTokenHash(tokenHash: string): Promise<ResetRecord | null>;
  markUsed(id: string): Promise<void>;
}

export interface UserAdminStore {
  findById(id: string): Promise<{ id: string; roles: readonly Role[]; isDesignatedReviewer: boolean } | null>;
  setPasswordHash(id: string, passwordHash: string): Promise<void>;
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export class InMemoryResetStore implements ResetStore {
  private readonly rows = new Map<string, ResetRecord>();

  async create(record: Omit<ResetRecord, "id" | "usedAt">): Promise<ResetRecord> {
    const row: ResetRecord = { ...record, id: randomBytes(16).toString("hex"), usedAt: null };
    this.rows.set(row.id, row);
    return row;
  }

  async findByTokenHash(tokenHash: string): Promise<ResetRecord | null> {
    for (const row of this.rows.values()) {
      if (row.tokenHash === tokenHash) return row;
    }
    return null;
  }

  async markUsed(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.usedAt = new Date();
  }
}

// A reset is usable only once, and only before it expires.
export function isUsable(record: ResetRecord, now: Date = new Date()): boolean {
  return record.usedAt === null && record.expiresAt.getTime() > now.getTime();
}
