import { randomBytes } from "node:crypto";

// Append-only audit service (spec Module 9, Task #9.1).
// Records business actions. The store has no update or delete method, and the database blocks both
// (see the audit_append_only migration). Values under sensitive keys are redacted before they are stored.

export interface AuditInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
}

export interface AuditRecord extends AuditInput {
  id: string;
  at: Date;
}

export interface AuditStore {
  append(record: AuditRecord): Promise<void>;
}

export interface AuditQuery {
  entityType?: string;
  action?: string;
  actorId?: string;
  page: number;
  pageSize: number;
}

export interface AuditReader {
  query(query: AuditQuery): Promise<{ items: AuditRecord[]; total: number }>;
}

// Keys whose values must never be stored: passwords, tokens, hashes, session and CSRF values.
const SENSITIVE_KEY = /password|passwd|secret|token|hash|csrf|cookie|authorization|api[-_]?key/i;
export const REDACTED = "[redacted]";

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(inner);
    }
    return out;
  }
  return value;
}

// Builds the stored record: new id, timestamp, and a redacted payload.
export function buildAuditRecord(input: AuditInput): AuditRecord {
  return {
    id: randomBytes(16).toString("hex"),
    at: new Date(),
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: redact(input.payload) as Record<string, unknown>,
  };
}

export async function recordAudit(store: AuditStore, input: AuditInput): Promise<void> {
  await store.append(buildAuditRecord(input));
}

// Prototype and test store.
export class InMemoryAuditStore implements AuditStore, AuditReader {
  private readonly rows: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.rows.push({ ...record, payload: structuredClone(record.payload) });
  }

  list(): readonly AuditRecord[] {
    return this.rows;
  }

  async query(query: AuditQuery): Promise<{ items: AuditRecord[]; total: number }> {
    const rows = this.rows
      .filter(
        (r) =>
          (!query.entityType || r.entityType === query.entityType) &&
          (!query.action || r.action === query.action) &&
          (!query.actorId || r.actorId === query.actorId),
      )
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    const start = (query.page - 1) * query.pageSize;
    return { items: rows.slice(start, start + query.pageSize), total: rows.length };
  }
}
