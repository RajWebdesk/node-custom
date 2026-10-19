import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Role } from "../domain/roles.js";

// D1 (approved by Hazel, relayed 2026-10-19): server-managed sessions with a per-session CSRF token.
// Cookie attributes: HttpOnly, Secure (outside test/dev http), SameSite=Strict.
// This in-memory store is for the prototype and tests. The Prisma-backed store (Session model) comes next.

export interface SessionRecord {
  id: string;
  userId: string;
  roles: readonly Role[];
  csrfToken: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SessionStore {
  create(userId: string, roles: readonly Role[], ttlMinutes: number): Promise<SessionRecord>;
  find(id: string): Promise<SessionRecord | null>;
  revoke(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  async create(userId: string, roles: readonly Role[], ttlMinutes: number): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: randomBytes(32).toString("base64url"),
      userId,
      roles,
      csrfToken: randomBytes(32).toString("base64url"),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      revokedAt: null,
    };
    this.sessions.set(record.id, record);
    return record;
  }

  async find(id: string): Promise<SessionRecord | null> {
    const record = this.sessions.get(id) ?? null;
    if (!record || record.revokedAt || record.expiresAt.getTime() <= Date.now()) return null;
    return record;
  }

  async revoke(id: string): Promise<void> {
    const record = this.sessions.get(id);
    if (record) record.revokedAt = new Date();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const record of this.sessions.values()) {
      if (record.userId === userId && !record.revokedAt) record.revokedAt = new Date();
    }
  }
}

export function csrfMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const SESSION_COOKIE = "sid";

// Minimal cookie parsing, no extra dependency.
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionCookie(id: string, secure: boolean, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(id)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return sessionCookie("", secure, 0);
}
