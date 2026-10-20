import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { hashPassword } from "../auth/password.js";
import {
  hashResetToken,
  isUsable,
  newResetToken,
  RESET_TTL_MINUTES,
  type ResetStore,
  type UserAdminStore,
} from "../auth/reset.js";
import type { SessionRecord, SessionStore } from "../auth/session.js";
import { recordAudit, type AuditStore } from "../audit/audit.js";

export interface ResetDeps {
  users: UserAdminStore;
  resets: ResetStore;
  sessions: SessionStore;
  audit: AuditStore;
}

// Only an authenticated Administrator may issue a reset token (spec Task #5.1 and #4.3).
export function requireAdministrator(req: Request, res: Response, next: NextFunction): void {
  const session = res.locals.session as SessionRecord | undefined;
  if (!session || !session.roles.includes("ADMINISTRATOR")) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

const userParams = z.object({ userId: z.string().min(1).max(64) });

// The token is returned once, to the administrator. Only its hash is stored.
export function issueResetHandler(deps: ResetDeps) {
  return async (req: Request, res: Response) => {
    try {
      const params = userParams.safeParse(req.params);
      if (!params.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const target = await deps.users.findById(params.data.userId);
      if (!target) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const session = res.locals.session as SessionRecord;
      const token = newResetToken();
      const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);
      await deps.resets.create({
        userId: target.id,
        tokenHash: hashResetToken(token),
        issuedById: session.userId,
        expiresAt,
      });
      await recordAudit(deps.audit, {
        actorId: session.userId,
        action: "user.reset_token_issued",
        entityType: "User",
        entityId: target.id,
        payload: { expiresAt: expiresAt.toISOString() },
      });
      res.status(201).json({ token, expiresAt: expiresAt.toISOString() });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

const redeemBody = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(12).max(1024),
});

const REDEEM_FAILED = { error: "invalid-or-expired-token" };

// Public route. Single use, time-limited. A successful reset revokes the user's sessions.
export function redeemResetHandler(deps: ResetDeps) {
  return async (req: Request, res: Response) => {
    try {
      const body = redeemBody.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const record = await deps.resets.findByTokenHash(hashResetToken(body.data.token));
      if (!record || !isUsable(record)) {
        res.status(400).json(REDEEM_FAILED);
        return;
      }
      const passwordHash = await hashPassword(body.data.newPassword);
      await deps.users.setPasswordHash(record.userId, passwordHash);
      await deps.resets.markUsed(record.id);
      await deps.sessions.revokeAllForUser(record.userId);
      await recordAudit(deps.audit, {
        actorId: record.userId,
        action: "user.password_reset_completed",
        entityType: "User",
        entityId: record.userId,
        payload: {},
      });
      res.status(204).end();
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}
