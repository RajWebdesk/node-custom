import type { Request, Response } from "express";
import { z } from "zod";
import type { AuditReader } from "../audit/audit.js";
import type { UserDirectory } from "../auth/user-directory.js";

// Activity log (spec Module 9, Task #9.2). Read-only. The audit store is append-only, so nothing here changes records.

export interface ActivityDeps {
  audit: AuditReader;
  directory: UserDirectory;
}

const query = z.object({
  entityType: z.string().trim().min(1).max(64).optional(),
  action: z.string().trim().min(1).max(64).optional(),
  actorId: z.string().trim().min(1).max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export function activityHandler(deps: ActivityDeps) {
  return async (req: Request, res: Response) => {
    try {
      const q = query.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const [{ items, total }, users] = await Promise.all([deps.audit.query(q.data), deps.directory.list()]);
      const names = new Map(users.map((u) => [u.id, u.name]));
      res.status(200).json({
        total,
        page: q.data.page,
        pageSize: q.data.pageSize,
        items: items.map((r) => ({
          at: r.at,
          actorName: r.actorId ? names.get(r.actorId) ?? "Former user" : "System",
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          payload: r.payload,
        })),
      });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}
