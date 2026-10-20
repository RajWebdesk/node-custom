import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { loadConfig } from "../config/env.js";
import { InMemorySessionStore, type SessionStore } from "../auth/session.js";
import { InMemoryResetStore, type ResetStore, type UserAdminStore } from "../auth/reset.js";
import {
  loginHandler,
  logoutHandler,
  requireCsrf,
  requireSession,
  type AuthDeps,
  type UserStore,
} from "./auth.js";
import { issueResetHandler, redeemResetHandler, requireAdministrator, type ResetDeps } from "./reset.js";
import { decideHandler, reviewQueueHandler, submissionDetailHandler, submitForReviewHandler, taskReviewsHandler } from "./approvals.js";
import { InMemoryApprovalStore, type ApprovalStore } from "../approvals/approval-store.js";
import { InMemoryNotificationStore, type NotificationStore } from "../notifications/notification-store.js";
import { createUserHandler, listUsersHandler, updateUserHandler } from "./users.js";
import { InMemoryUserDirectory, type UserDirectory } from "../auth/user-directory.js";
import { changePasswordHandler, getProfileHandler, updateProfileHandler } from "./profile.js";
import { createTaskHandler, getTaskHandler, listAssignableUsersHandler, listTasksHandler, moveTaskStatusHandler, requireTaskManager, taskHistoryHandler, updateTaskHandler } from "./tasks.js";
import { InMemoryTaskStore, type TaskStore } from "../tasks/task-store.js";
import { InMemoryAuditStore, type AuditReader, type AuditStore } from "../audit/audit.js";
import { activityHandler } from "./activity.js";
import { dashboardHandler } from "./dashboard.js";
import { taskReportHandler } from "./reports.js";
import { settingsHandler } from "./settings.js";
import { statusHistoryReportHandler, timeReportHandler } from "./report-history.js";
import { listNotificationsHandler, markAllNotificationsReadHandler, markNotificationReadHandler } from "./notifications.js";
import { consoleLogger, Metrics, requestObserver, silentLogger, withTimeout, type Logger } from "../observability/observability.js";
import { InMemoryAllocationStore, type AllocationStore } from "../allocation/allocation-store.js";
import { adjustAllocationHandler, allocationHistoryHandler, listAllocationsHandler } from "./allocation.js";

// Prototype API. Authentication (D1 sessions with CSRF, D2 Argon2id) is implemented against
// in-memory stores. The Prisma-backed stores are added with the data layer.

export interface AppOptions {
  users?: UserStore;
  sessions?: SessionStore;
  userAdmin?: UserAdminStore;
  resets?: ResetStore;
  approvals?: ApprovalStore;
  userDirectory?: UserDirectory;
  taskStore?: TaskStore;
  audit?: AuditStore & AuditReader;
  allocations?: AllocationStore;
  notifications?: NotificationStore;
  // Database check for readiness. Resolves when the database answers; throws when it does not.
  dbCheck?: () => Promise<void>;
  logger?: Logger;
  metrics?: Metrics;
}

const submissionParams = z.object({
  submissionId: z.string().min(1).max(64),
});

export function createApp(options: AppOptions = {}): express.Express {
  // One audit store for every business action in this app instance.
  const audit = options.audit ?? new InMemoryAuditStore();
  const metrics = options.metrics ?? new Metrics();
  const logger = options.logger ?? (process.env.NODE_ENV === "test" ? silentLogger : consoleLogger);
  const auth: AuthDeps = {
    // With no user store supplied, nobody can log in. This is the safe default.
    users: options.users ?? { findByEmail: async () => null },
    sessions: options.sessions ?? new InMemorySessionStore(),
    ttlMinutes: 60,
    secureCookies: process.env.NODE_ENV === "production",
  };

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  // Structured request log and metrics for every request (G5.5). Logs hold no headers, cookies, or bodies.
  app.use(requestObserver(logger, metrics));

  // CORS for the configured web origin only. Credentials allowed so the session cookie is sent.
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  app.use((req, res, next) => {
    if (req.headers.origin === webOrigin) {
      res.setHeader("Access-Control-Allow-Origin", webOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Liveness: the process is running.
  app.get("/health/live", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Readiness: startup configuration is valid and the database answers within 2 seconds.
  app.get("/health/ready", async (_req, res) => {
    const result = loadConfig(process.env);
    if (!result.ok) {
      // Report field names only, never values.
      res.status(503).json({ status: "not-ready", missing_or_invalid: result.errors.length });
      return;
    }
    const databaseOk = options.dbCheck ? await withTimeout(options.dbCheck, 2000) : true;
    if (!databaseOk) {
      res.status(503).json({ status: "not-ready", database: "unreachable" });
      return;
    }
    res.status(200).json({ status: "ready" });
  });

  // Exported metrics (profile operations.metrics.mode = exported). Counts and durations only; no personal data.
  app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.status(200).send(metrics.render());
  });

  const resetDeps: ResetDeps = {
    users: options.userAdmin ?? { findById: async () => null, setPasswordHash: async () => undefined, getPasswordHash: async () => null },
    resets: options.resets ?? new InMemoryResetStore(),
    sessions: auth.sessions,
    audit,
  };

  app.post("/api/v1/auth/login", loginHandler(auth));
  // Administrator-assisted reset (spec Task #4.3). No self-service reset.
  app.post(
    "/api/v1/admin/users/:userId/reset-token",
    requireSession(auth),
    requireCsrf,
    requireAdministrator,
    issueResetHandler(resetDeps),
  );
  app.post("/api/v1/auth/reset", redeemResetHandler(resetDeps));

  // User administration (spec Task #5.1). Administrator only; writes also need the CSRF token.
  const usersDeps = {
    directory: options.userDirectory ?? new InMemoryUserDirectory(),
    sessions: auth.sessions,
    audit,
  };
  app.get("/api/v1/admin/users", requireSession(auth), requireAdministrator, listUsersHandler(usersDeps));
  app.post(
    "/api/v1/admin/users",
    requireSession(auth),
    requireCsrf,
    requireAdministrator,
    createUserHandler(usersDeps),
  );
  app.patch(
    "/api/v1/admin/users/:userId",
    requireSession(auth),
    requireCsrf,
    requireAdministrator,
    updateUserHandler(usersDeps),
  );

  // Self-service profile and password change (Task #5.2). Any signed-in user, for their own account only.
  const profileDeps = {
    directory: usersDeps.directory,
    userAdmin: resetDeps.users,
    sessions: auth.sessions,
    secureCookies: auth.secureCookies,
    audit,
  };
  app.get("/api/v1/me", requireSession(auth), getProfileHandler(profileDeps));
  app.patch("/api/v1/me", requireSession(auth), requireCsrf, updateProfileHandler(profileDeps));
  app.post("/api/v1/me/password", requireSession(auth), requireCsrf, changePasswordHandler(profileDeps));

  // Task API (spec Module 6). Reads are filtered by role inside the handlers; writes need a manager or administrator.
  const taskDeps = { tasks: options.taskStore ?? new InMemoryTaskStore(), directory: usersDeps.directory, audit };
  app.get("/api/v1/tasks", requireSession(auth), listTasksHandler(taskDeps));

  // Activity log for administrators (Task #9.2). Read-only.
  app.get("/api/v1/activity", requireSession(auth), requireAdministrator, activityHandler({ audit, directory: usersDeps.directory }));

  // Planned time allocation (Module 8). Reads are role-scoped in the handlers; only administrators change it.
  const allocationDeps = {
    allocations: options.allocations ?? new InMemoryAllocationStore(audit),
    directory: usersDeps.directory,
  };
  app.get("/api/v1/allocations", requireSession(auth), listAllocationsHandler(allocationDeps));
  app.get("/api/v1/allocations/:subjectId/history", requireSession(auth), allocationHistoryHandler(allocationDeps));
  app.post(
    "/api/v1/admin/allocations/:subjectId/adjust",
    requireSession(auth),
    requireCsrf,
    requireAdministrator,
    adjustAllocationHandler(allocationDeps),
  );
  app.get("/api/v1/directory/users", requireSession(auth), requireTaskManager, listAssignableUsersHandler(taskDeps));
  app.get("/api/v1/tasks/:taskId", requireSession(auth), getTaskHandler(taskDeps));
  app.get("/api/v1/tasks/:taskId/history", requireSession(auth), taskHistoryHandler(taskDeps));
  app.post("/api/v1/tasks", requireSession(auth), requireCsrf, requireTaskManager, createTaskHandler(taskDeps));
  app.patch("/api/v1/tasks/:taskId", requireSession(auth), requireCsrf, requireTaskManager, updateTaskHandler(taskDeps));
  app.post("/api/v1/tasks/:taskId/status", requireSession(auth), requireCsrf, moveTaskStatusHandler(taskDeps));
  app.post("/api/v1/auth/logout", requireSession(auth), requireCsrf, logoutHandler(auth));

  // Approval workflow (spec Module 10). Writes need the CSRF token; the handlers apply the reviewer and
  // assignee rules. Each change, its status move, and its audit record are stored together.
  const notifications = options.notifications ?? new InMemoryNotificationStore();
  const approvalDeps = {
    approvals: options.approvals ?? new InMemoryApprovalStore(taskDeps.tasks, audit, notifications),
    tasks: taskDeps.tasks,
    directory: usersDeps.directory,
  };
  app.post("/api/v1/tasks/:taskId/submissions", requireSession(auth), requireCsrf, submitForReviewHandler(approvalDeps));
  app.get("/api/v1/tasks/:taskId/reviews", requireSession(auth), taskReviewsHandler(approvalDeps));
  app.get("/api/v1/reviews", requireSession(auth), reviewQueueHandler(approvalDeps));
  app.get("/api/v1/submissions/:id", requireSession(auth), submissionDetailHandler(approvalDeps));
  app.post("/api/v1/submissions/:id/decisions", requireSession(auth), requireCsrf, decideHandler(approvalDeps));

  // Dashboard (Module 12) and in-app inbox (Module 11). Everything is scoped to the signed-in person.
  app.get("/api/v1/dashboard", requireSession(auth), dashboardHandler({
    tasks: taskDeps.tasks,
    allocations: allocationDeps.allocations,
    approvals: approvalDeps.approvals,
    notifications,
    audit: audit as AuditReader,
    directory: usersDeps.directory,
  }));
  // Task reports (Module 13). Read-only; visibility follows the task list.
  app.get("/api/v1/reports/tasks", requireSession(auth), taskReportHandler({ tasks: taskDeps.tasks, directory: usersDeps.directory }));
  const historyReportDeps = { tasks: taskDeps.tasks, allocations: allocationDeps.allocations, directory: usersDeps.directory };
  app.get("/api/v1/reports/time", requireSession(auth), timeReportHandler(historyReportDeps));
  app.get("/api/v1/reports/history", requireSession(auth), statusHistoryReportHandler(historyReportDeps));
  // Settings view for administrators (Task #13.4). Read-only.
  app.get("/api/v1/admin/settings", requireSession(auth), requireAdministrator, settingsHandler());
  app.get("/api/v1/notifications", requireSession(auth), listNotificationsHandler({ notifications }));
  app.post("/api/v1/notifications/read-all", requireSession(auth), requireCsrf, markAllNotificationsReadHandler({ notifications }));
  app.post("/api/v1/notifications/:id/read", requireSession(auth), requireCsrf, markNotificationReadHandler({ notifications }));

  app.use((_req, res) => {
    res.status(404).json({ error: "not-found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Client errors raised by the body parser (oversized or malformed JSON) keep their status, with a generic code.
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const code = status === 413 ? "payload-too-large" : status === 400 ? "malformed-request" : "client-error";
      res.status(status).json({ error: code });
      return;
    }
    // Anything else is a server fault. Details are never returned.
    res.status(500).json({ error: "internal-error" });
  });

  return app;
}
