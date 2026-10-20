import type { Request, Response } from "express";
import type { TaskStore, TaskRecord } from "../tasks/task-store.js";
import type { AllocationStore } from "../allocation/allocation-store.js";
import type { ApprovalStore } from "../approvals/approval-store.js";
import type { NotificationStore } from "../notifications/notification-store.js";
import type { AuditReader } from "../audit/audit.js";
import type { UserDirectory } from "../auth/user-directory.js";
import type { SessionRecord } from "../auth/session.js";
import type { Actor, Role } from "../domain/roles.js";
import { canManageTasks } from "../domain/tasks.js";
import { localParts, APP_TIMEZONE, dueStatus } from "../domain/schedule.js";

// Role-scoped dashboard (spec Module 12, Task #12.1). Counts follow the same visibility as the lists they link to.

export interface DashboardDeps {
  tasks: TaskStore;
  allocations: AllocationStore;
  approvals: ApprovalStore;
  notifications: NotificationStore;
  audit: AuditReader;
  directory: UserDirectory;
}

const PAGE = 100;

// Every visible, unarchived task (paged through the store, which caps a page at 100).
async function visibleTasks(deps: DashboardDeps, actor: Actor): Promise<TaskRecord[]> {
  const all: TaskRecord[] = [];
  for (let page = 1; ; page++) {
    const { items, total } = await deps.tasks.list({
      archived: false,
      page,
      pageSize: PAGE,
      sortBy: "createdAt",
      sortDir: "asc",
      onlyAssigneeId: canManageTasks(actor) ? undefined : actor.id,
    });
    all.push(...items);
    if (all.length >= total || items.length === 0) return all;
  }
}

export function dashboardHandler(deps: DashboardDeps) {
  return async (_req: Request, res: Response) => {
    try {
      const session = res.locals.session as SessionRecord;
      const user = await deps.directory.findById(session.userId);
      if (!user || user.status !== "active") {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const actor: Actor = { id: user.id, roles: session.roles as readonly Role[], isDesignatedReviewer: user.isDesignatedReviewer };
      const today = localParts(new Date(), APP_TIMEZONE).date;
      const tasks = await visibleTasks(deps, actor);
      const open = tasks.filter((t) => t.status !== "Approved");
      const overdue = open.filter((t) => dueStatus(t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null, today) === "overdue");

      // Reviewers count their own queue. Everyone else counts visible tasks waiting for review.
      const awaitingReview = user.isDesignatedReviewer
        ? (await deps.approvals.listPendingFor(user.id)).length
        : tasks.filter((t) => t.status === "In Review").length;

      // Planned time: everyone for administrators and managers, own allocation for employees.
      let plannedHours: number | null = null;
      if (canManageTasks(actor)) {
        plannedHours = (await deps.allocations.list()).reduce((sum, a) => sum + a.plannedHours, 0);
      } else {
        plannedHours = (await deps.allocations.findBySubject(user.id))?.plannedHours ?? null;
      }

      const unread = await deps.notifications.unreadCount(user.id);

      // Recent activity: the audit log for administrators; the person's own notifications for everyone else.
      let recent: { at: Date; text: string }[];
      if (session.roles.includes("ADMINISTRATOR")) {
        const log = await deps.audit.query({ page: 1, pageSize: 5 });
        recent = log.items.map((r) => ({ at: r.at, text: r.action }));
      } else {
        const mine = await deps.notifications.listFor(user.id, { unreadOnly: false, limit: 5 });
        recent = mine.map((n) => ({ at: n.createdAt, text: n.kind }));
      }

      res.status(200).json({
        today,
        metrics: [
          { key: "open", label: "Open tasks", value: open.length, href: "/tasks" },
          { key: "review", label: "Waiting for review", value: awaitingReview, href: user.isDesignatedReviewer ? "/reviews" : "/tasks" },
          { key: "overdue", label: "Overdue", value: overdue.length, href: "/tasks" },
          { key: "planned", label: "Planned hours", value: plannedHours, href: "/time" },
          { key: "unread", label: "Unread notifications", value: unread, href: "/notifications" },
        ],
        recent,
      });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}
