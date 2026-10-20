import { randomBytes } from "node:crypto";

// In-app notifications and the email outbox (spec Module 11, Tasks #11.1 and #11.3).
// A notification is written in the same transaction as the change that caused it, so it exists if and only if
// the change does. Email is sent later from the outbox; an email failure never changes the notification's source.

export type NotificationKind =
  | "review.requested"
  | "review.decided"
  | "task.reminder";

export type EmailStatus = "pending" | "sent" | "suppressed" | "quarantined";

export interface NotificationRecord {
  id: string;
  recipientId: string;
  kind: NotificationKind;
  taskId: string | null;
  payload: Record<string, unknown>;
  readAt: Date | null;
  emailStatus: EmailStatus;
  createdAt: Date;
}

export interface NewNotification {
  recipientId: string;
  kind: NotificationKind;
  taskId: string | null;
  payload: Record<string, unknown>;
}

export interface NotificationStore {
  listFor(recipientId: string, options: { unreadOnly: boolean; limit: number }): Promise<NotificationRecord[]>;
  unreadCount(recipientId: string): Promise<number>;
  // Marks one notification read. Returns false when it does not belong to the recipient or does not exist.
  markRead(id: string, recipientId: string): Promise<boolean>;
  markAllRead(recipientId: string): Promise<number>;
  pendingEmail(limit: number): Promise<NotificationRecord[]>;
  setEmailStatus(id: string, status: EmailStatus): Promise<void>;
  // Synchronous write, used by the in-memory approval store. The Prisma approval store writes in its transaction.
  add(items: NewNotification[]): NotificationRecord[];
}

// Prototype and test store. The approval store writes into it through the same call sequence as Prisma.
export class InMemoryNotificationStore implements NotificationStore {
  private readonly rows: NotificationRecord[] = [];

  add(items: NewNotification[]): NotificationRecord[] {
    const created = items.map((n) => ({
      id: randomBytes(16).toString("hex"),
      recipientId: n.recipientId,
      kind: n.kind,
      taskId: n.taskId,
      payload: { ...n.payload },
      readAt: null,
      emailStatus: "pending" as EmailStatus,
      createdAt: new Date(),
    }));
    this.rows.push(...created);
    return created.map((r) => ({ ...r }));
  }

  async listFor(recipientId: string, options: { unreadOnly: boolean; limit: number }): Promise<NotificationRecord[]> {
    return this.rows
      .filter((r) => r.recipientId === recipientId && (!options.unreadOnly || r.readAt === null))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.limit)
      .map((r) => ({ ...r }));
  }

  async unreadCount(recipientId: string): Promise<number> {
    return this.rows.filter((r) => r.recipientId === recipientId && r.readAt === null).length;
  }

  async markRead(id: string, recipientId: string): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id && r.recipientId === recipientId);
    if (!row) return false;
    row.readAt ??= new Date();
    return true;
  }

  async markAllRead(recipientId: string): Promise<number> {
    let n = 0;
    for (const r of this.rows) {
      if (r.recipientId === recipientId && r.readAt === null) {
        r.readAt = new Date();
        n++;
      }
    }
    return n;
  }

  async pendingEmail(limit: number): Promise<NotificationRecord[]> {
    return this.rows.filter((r) => r.emailStatus === "pending").slice(0, limit).map((r) => ({ ...r }));
  }

  async setEmailStatus(id: string, status: EmailStatus): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.emailStatus = status;
  }
}
