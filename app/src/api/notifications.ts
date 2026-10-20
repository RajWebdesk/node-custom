import type { Request, Response } from "express";
import { z } from "zod";
import type { NotificationStore } from "../notifications/notification-store.js";
import type { SessionRecord } from "../auth/session.js";

// In-app inbox (spec Module 11, Task #11.1). Each person sees and changes only their own notifications.

export interface NotificationDeps {
  notifications: NotificationStore;
}

const listQuery = z.object({
  unread: z.enum(["true", "false"]).default("false"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const idParams = z.object({ id: z.string().min(1).max(64) });

export function listNotificationsHandler(deps: NotificationDeps) {
  return async (req: Request, res: Response) => {
    try {
      const q = listQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const me = (res.locals.session as SessionRecord).userId;
      const [items, unreadCount] = await Promise.all([
        deps.notifications.listFor(me, { unreadOnly: q.data.unread === "true", limit: q.data.limit }),
        deps.notifications.unreadCount(me),
      ]);
      res.status(200).json({
        unreadCount,
        items: items.map((n) => ({
          id: n.id,
          kind: n.kind,
          taskId: n.taskId,
          payload: n.payload,
          readAt: n.readAt,
          createdAt: n.createdAt,
        })),
      });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

export function markNotificationReadHandler(deps: NotificationDeps) {
  return async (req: Request, res: Response) => {
    try {
      const p = idParams.safeParse(req.params);
      if (!p.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const me = (res.locals.session as SessionRecord).userId;
      const ok = await deps.notifications.markRead(p.data.id, me);
      if (!ok) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      res.status(204).end();
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

export function markAllNotificationsReadHandler(deps: NotificationDeps) {
  return async (_req: Request, res: Response) => {
    try {
      const me = (res.locals.session as SessionRecord).userId;
      const marked = await deps.notifications.markAllRead(me);
      res.status(200).json({ marked });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}
