import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { loadConfig } from "../config/env.js";
import { DECISIONS } from "../domain/approval.js";
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
import { decisionHandler, InMemoryApprovalStore, type ApprovalStore } from "./decisions.js";

// Prototype API. Authentication (D1 sessions with CSRF, D2 Argon2id) is implemented against
// in-memory stores. The Prisma-backed stores are added with the data layer.

export interface AppOptions {
  users?: UserStore;
  sessions?: SessionStore;
  userAdmin?: UserAdminStore;
  resets?: ResetStore;
  approvals?: ApprovalStore;
}

const decisionBody = z.object({
  decision: z.enum(DECISIONS as [string, ...string[]]),
});

const submissionParams = z.object({
  submissionId: z.string().min(1).max(64),
});

export function createApp(options: AppOptions = {}): express.Express {
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

  // CORS for the configured web origin only. Credentials allowed so the session cookie is sent.
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  app.use((req, res, next) => {
    if (req.headers.origin === webOrigin) {
      res.setHeader("Access-Control-Allow-Origin", webOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

  // Readiness: startup configuration is valid. Database check added with the data layer.
  app.get("/health/ready", (_req, res) => {
    const result = loadConfig(process.env);
    if (result.ok) {
      res.status(200).json({ status: "ready" });
    } else {
      // Report field names only, never values.
      res.status(503).json({ status: "not-ready", missing_or_invalid: result.errors.length });
    }
  });

  const resetDeps: ResetDeps = {
    users: options.userAdmin ?? { findById: async () => null, setPasswordHash: async () => undefined },
    resets: options.resets ?? new InMemoryResetStore(),
    sessions: auth.sessions,
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
  app.post("/api/v1/auth/logout", requireSession(auth), requireCsrf, logoutHandler(auth));

  // Approval decisions (spec Module 10): authenticated, CSRF-checked, designated reviewer only.
  app.post(
    "/api/v1/submissions/:submissionId/decisions",
    requireSession(auth),
    requireCsrf,
    decisionHandler({
      users: resetDeps.users,
      approvals: options.approvals ?? new InMemoryApprovalStore(),
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "not-found" });
  });

  app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Generic error body. Details are never returned.
    res.status(500).json({ error: "internal-error" });
  });

  return app;
}
