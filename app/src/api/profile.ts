import type { Request, Response } from "express";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../auth/password.js";
import type { UserAdminStore } from "../auth/reset.js";
import { clearSessionCookie, type SessionRecord, type SessionStore } from "../auth/session.js";
import type { UserDirectory } from "../auth/user-directory.js";
import { recordAudit, type AuditStore } from "../audit/audit.js";

// Self-service profile and password change (spec Task #5.2). This is not password reset:
// a signed-in user changes their own password with their current one. Email-based reset stays out of scope.

export interface ProfileDeps {
  directory: UserDirectory;
  userAdmin: UserAdminStore;
  sessions: SessionStore;
  secureCookies: boolean;
  audit: AuditStore;
}

// Only the display name is editable by the user. Roles and status are administrator-only.
const nameBody = z.object({ name: z.string().trim().min(1).max(200) }).strict();

const passwordBody = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(12).max(1024),
});

export function getProfileHandler(deps: ProfileDeps) {
  return async (_req: Request, res: Response) => {
    try {
      const actor = res.locals.session as SessionRecord;
      const me = await deps.directory.findById(actor.userId);
      if (!me) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      res.status(200).json(me);
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

export function updateProfileHandler(deps: ProfileDeps) {
  return async (req: Request, res: Response) => {
    try {
      const body = nameBody.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const actor = res.locals.session as SessionRecord;
      const updated = await deps.directory.update(actor.userId, { name: body.data.name });
      if (!updated) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      await recordAudit(deps.audit, {
        actorId: actor.userId,
        action: "user.profile_updated",
        entityType: "User",
        entityId: actor.userId,
        payload: { name: body.data.name },
      });
      res.status(200).json(updated);
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

// Success revokes every session for the user, including this one, and clears the cookie.
// The user signs in again with the new password.
export function changePasswordHandler(deps: ProfileDeps) {
  return async (req: Request, res: Response) => {
    try {
      const body = passwordBody.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const actor = res.locals.session as SessionRecord;
      const stored = await deps.userAdmin.getPasswordHash(actor.userId);
      if (!stored) {
        res.status(401).json({ error: "authentication-required" });
        return;
      }
      if (!(await verifyPassword(stored, body.data.currentPassword))) {
        res.status(400).json({ error: "current-password-incorrect" });
        return;
      }
      if (await verifyPassword(stored, body.data.newPassword)) {
        res.status(400).json({ error: "password-unchanged" });
        return;
      }
      await deps.userAdmin.setPasswordHash(actor.userId, await hashPassword(body.data.newPassword));
      await deps.sessions.revokeAllForUser(actor.userId);
      await recordAudit(deps.audit, {
        actorId: actor.userId,
        action: "user.password_changed",
        entityType: "User",
        entityId: actor.userId,
        payload: {},
      });
      res.setHeader("Set-Cookie", clearSessionCookie(deps.secureCookies));
      res.status(204).end();
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}
