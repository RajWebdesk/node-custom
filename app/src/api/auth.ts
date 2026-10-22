import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { Role } from "../domain/roles.js";
import { verifyPassword } from "../auth/password.js";
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, LoginLimiter } from "../auth/login-limiter.js";
import {
  clearSessionCookie,
  csrfMatches,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  type SessionRecord,
  type SessionStore,
} from "../auth/session.js";

// Account lookup. The Prisma-backed implementation is added with the data layer.
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  roles: readonly Role[];
  status: "active" | "deactivated";
  isDesignatedReviewer: boolean;
}

export interface UserStore {
  findByEmail(email: string): Promise<UserRecord | null>;
}

export interface AuthDeps {
  users: UserStore;
  sessions: SessionStore;
  ttlMinutes: number;
  secureCookies: boolean;
  // Sign-in failure limit. One instance is created per app when not given (pilot decision, 2026-10-21).
  limiter?: LoginLimiter;
}

// Generic failure message. Never reveals whether the email exists.
const LOGIN_FAILED = { error: "invalid-credentials" };

const loginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
});

export function loginHandler(deps: AuthDeps) {
  const limiter = deps.limiter ?? new LoginLimiter({ maxFailures: LOGIN_MAX_FAILURES, windowMs: LOGIN_WINDOW_MS });
  return async (req: Request, res: Response) => {
    try {
      await handleLogin(deps, limiter, req, res);
    } catch {
      // Database or hashing failure: generic error, no details, process keeps running.
      res.status(500).json({ error: "internal-error" });
    }
  };
}

async function handleLogin(deps: AuthDeps, limiter: LoginLimiter, req: Request, res: Response): Promise<void> {
    const body = loginBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "validation-failed" });
      return;
    }
    const email = body.data.email.toLowerCase();
    const keys = LoginLimiter.keysFor(email, req.ip ?? "unknown");
    const wait = limiter.retryAfterSeconds(keys);
    if (wait > 0) {
      res.setHeader("Retry-After", String(wait));
      res.status(429).json({ error: "too-many-attempts" });
      return;
    }
    const user = await deps.users.findByEmail(email);
    // Verify even when the user is missing, to keep timing similar.
    const ok = await verifyPassword(
      user?.passwordHash ?? "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      body.data.password,
    );
    if (!user || !ok || user.status !== "active") {
      limiter.recordFailure(keys);
      res.status(401).json(LOGIN_FAILED);
      return;
    }
    limiter.reset(keys[0]);
    const session = await deps.sessions.create(user.id, user.roles, deps.ttlMinutes);
    res.setHeader(
      "Set-Cookie",
      sessionCookie(session.id, deps.secureCookies, deps.ttlMinutes * 60),
    );
    // The CSRF token is returned to the page, not stored in a cookie.
    res.status(200).json({ csrfToken: session.csrfToken });
}

// Resolves the session from the cookie. Sets res.locals.session when valid.
export function requireSession(deps: AuthDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = readCookie(req.headers.cookie, SESSION_COOKIE);
      const session = id ? await deps.sessions.find(id) : null;
      if (!session) {
        res.status(401).json({ error: "authentication-required" });
        return;
      }
      res.locals.session = session as SessionRecord;
    } catch {
      res.status(500).json({ error: "internal-error" });
      return;
    }
    next();
  };
}

// CSRF check for state-changing requests. Must run after requireSession.
export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  const session = res.locals.session as SessionRecord | undefined;
  const provided = req.header("x-csrf-token");
  if (!session || !csrfMatches(session.csrfToken, provided)) {
    res.status(403).json({ error: "csrf-check-failed" });
    return;
  }
  next();
}

export function logoutHandler(deps: AuthDeps) {
  return async (req: Request, res: Response) => {
    const session = res.locals.session as SessionRecord | undefined;
    if (session) await deps.sessions.revoke(session.id);
    res.setHeader("Set-Cookie", clearSessionCookie(deps.secureCookies));
    res.status(204).end();
  };
}
