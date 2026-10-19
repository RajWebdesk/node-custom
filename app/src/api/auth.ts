import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { Role } from "../domain/roles.js";
import { verifyPassword } from "../auth/password.js";
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
}

// Generic failure message. Never reveals whether the email exists.
const LOGIN_FAILED = { error: "invalid-credentials" };

const loginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
});

export function loginHandler(deps: AuthDeps) {
  return async (req: Request, res: Response) => {
    try {
      await handleLogin(deps, req, res);
    } catch {
      // Database or hashing failure: generic error, no details, process keeps running.
      res.status(500).json({ error: "internal-error" });
    }
  };
}

async function handleLogin(deps: AuthDeps, req: Request, res: Response): Promise<void> {
    const body = loginBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "validation-failed" });
      return;
    }
    const user = await deps.users.findByEmail(body.data.email.toLowerCase());
    // Verify even when the user is missing, to keep timing similar.
    const ok = await verifyPassword(
      user?.passwordHash ?? "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      body.data.password,
    );
    if (!user || !ok || user.status !== "active") {
      res.status(401).json(LOGIN_FAILED);
      return;
    }
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
