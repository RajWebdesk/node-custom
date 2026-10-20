import type { UserDirectory } from "../auth/user-directory.js";
import type { NotificationRecord, NotificationStore } from "./notification-store.js";

// Email outbox (spec Module 11, Task #11.3). Email is sent from pending notifications, never inside a task or
// approval change. Outcomes:
//   suppressed  the pilot transport: nothing is sent; the notification is kept as the record
//   sent        the provider accepted the message
//   quarantined the outcome is unknown or the recipient cannot be used. There is no automatic retry
//               (D-email-contract: uncertain write, escalate). A person decides what to do.

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailTransport {
  // True for the pilot transport. Nothing is sent, and no provider is contacted.
  readonly suppressed: boolean;
  send(message: EmailMessage): Promise<void>;
}

// The pilot transport. No real emails are sent during the pilot (D-email-contract, profile decision).
export const pilotTransport: EmailTransport = {
  suppressed: true,
  send: async () => {
    throw new Error("pilot transport does not send");
  },
};

// Chooses the transport from configuration. Without a provider setting the pilot transport is used.
// A provider setting alone is refused until a provider is confirmed (the provider decision is with the WDS team).
export function transportFromEnv(env: NodeJS.ProcessEnv): EmailTransport {
  if (!env.EMAIL_PROVIDER) return pilotTransport;
  throw new Error("EMAIL_PROVIDER is set, but no provider is integrated yet. The provider decision is pending.");
}

// Generic text only: the email never carries task titles or other content, so it is safe to read on any device.
export function messageFor(notification: NotificationRecord, recipientEmail: string): EmailMessage {
  const subjects: Record<string, string> = {
    "review.requested": "A task is waiting for your review",
    "review.decided": "A review decision was recorded",
    "task.reminder": "A task is due soon or overdue",
  };
  return {
    to: recipientEmail,
    subject: subjects[notification.kind] ?? "You have a new notification",
    body: "Sign in to the task app to see the details. This message contains no task content.",
  };
}

export interface OutboxResult {
  suppressed: number;
  sent: number;
  quarantined: number;
}

export async function processOutbox(deps: {
  notifications: NotificationStore;
  users: UserDirectory;
  transport: EmailTransport;
  limit: number;
}): Promise<OutboxResult> {
  const result: OutboxResult = { suppressed: 0, sent: 0, quarantined: 0 };
  const pending = await deps.notifications.pendingEmail(deps.limit);
  for (const n of pending) {
    if (deps.transport.suppressed) {
      await deps.notifications.setEmailStatus(n.id, "suppressed");
      result.suppressed++;
      continue;
    }
    const recipient = await deps.users.findById(n.recipientId);
    if (!recipient || recipient.status !== "active") {
      await deps.notifications.setEmailStatus(n.id, "quarantined");
      result.quarantined++;
      continue;
    }
    try {
      await deps.transport.send(messageFor(n, recipient.email));
      await deps.notifications.setEmailStatus(n.id, "sent");
      result.sent++;
    } catch {
      // Unknown outcome: quarantine, never retry automatically. The task or approval change is not touched.
      await deps.notifications.setEmailStatus(n.id, "quarantined");
      result.quarantined++;
    }
  }
  return result;
}
