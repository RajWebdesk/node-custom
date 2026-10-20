import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { hashPassword } from "../auth/password.js";
import { DuplicateEmailError, type UserDirectory } from "../auth/user-directory.js";
import type { SessionRecord, SessionStore } from "../auth/session.js";
import { ROLES } from "../domain/roles.js";
import { recordAudit, type AuditStore } from "../audit/audit.js";

// Administrator user management (spec Task #5.1). Mounted behind requireSession, requireCsrf (writes),
// and requireAdministrator. Designated-reviewer status is not editable here.

export interface UsersDeps {
  directory: UserDirectory;
  sessions: SessionStore;
  audit: AuditStore;
}

const userParams = z.object({ userId: z.string().min(1).max(64) });

const roleList = z.array(z.enum(ROLES)).min(1).max(ROLES.length);

const createBody = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(254),
  roles: roleList,
});

const patchBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    roles: roleList.optional(),
    status: z.enum(["active", "deactivated"]).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "empty-patch" });

export function listUsersHandler(deps: UsersDeps) {
  return async (_req: Request, res: Response) => {
    try {
      res.status(200).json({ users: await deps.directory.list() });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

// The new account gets a random, unknown password. It cannot sign in until an administrator
// issues a reset token (Task #4.3), so no initial password is ever shown or stored in clear.
export function createUserHandler(deps: UsersDeps) {
  return async (req: Request, res: Response) => {
    try {
      const body = createBody.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
      const user = await deps.directory.create({ ...body.data, passwordHash });
      await recordAudit(deps.audit, {
        actorId: (res.locals.session as SessionRecord).userId,
        action: "user.created",
        entityType: "User",
        entityId: user.id,
        payload: { email: user.email, roles: user.roles },
      });
      res.status(201).json(user);
    } catch (err) {
      if (err instanceof DuplicateEmailError) {
        res.status(409).json({ error: "email-taken" });
        return;
      }
      res.status(500).json({ error: "internal-error" });
    }
  };
}

// Safety rules: an administrator cannot deactivate themselves or remove their own Administrator role
// (prevents lock-out). Deactivation and role changes revoke the user's sessions so the change applies
// on the next request.
export function updateUserHandler(deps: UsersDeps) {
  return async (req: Request, res: Response) => {
    try {
      const params = userParams.safeParse(req.params);
      const body = patchBody.safeParse(req.body);
      if (!params.success || !body.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const actor = res.locals.session as SessionRecord;
      const { userId } = params.data;
      const patch = body.data;

      if (userId === actor.userId) {
        const deactivates = patch.status === "deactivated";
        const dropsAdmin = patch.roles !== undefined && !patch.roles.includes("ADMINISTRATOR");
        if (deactivates || dropsAdmin) {
          res.status(409).json({ error: "self-change-refused" });
          return;
        }
      }

      const updated = await deps.directory.update(userId, patch);
      if (!updated) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      if (patch.status === "deactivated" || patch.roles !== undefined) {
        await deps.sessions.revokeAllForUser(userId);
      }
      await recordAudit(deps.audit, {
        actorId: actor.id,
        action: "user.updated",
        entityType: "User",
        entityId: updated.id,
        payload: { changes: patch },
      });
      res.status(200).json(updated);
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}
