"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, formatDate } from "../lib/api";
import { StateMessage } from "./StateMessage";

// Inbox (Task #11.2). Mark one or all as read. Each row links to its task where there is one.

interface Item {
  id: string;
  kind: string;
  taskId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

const LABELS: Record<string, string> = {
  "review.requested": "A task is waiting for your review",
  "review.decided": "A review decision was recorded on your task",
  "task.reminder": "A task is due soon or overdue",
};

export function NotificationsPanel() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest("/api/v1/notifications?limit=100");
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const body = (await res.json()) as { unreadCount: number; items: Item[] };
      setItems(body.items);
      setUnread(body.unreadCount);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    await apiRequest(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: "POST", body: {} });
    await load();
  }

  async function markAll() {
    await apiRequest("/api/v1/notifications/read-all", { method: "POST", body: {} });
    await load();
  }

  if (failed) return <StateMessage kind="error" />;
  if (!items) return <StateMessage kind="loading" />;
  if (items.length === 0) return <StateMessage kind="empty" detail="No notifications yet." />;

  return (
    <>
      <p>
        {unread} unread.{" "}
        {unread > 0 ? (
          <button className="button" type="button" onClick={() => void markAll()}>
            Mark all as read
          </button>
        ) : null}
      </p>
      <ul className="card">
        {items.map((n) => (
          <li key={n.id}>
            {n.readAt ? null : <strong>New: </strong>}
            {LABELS[n.kind] ?? "Notification"} ({formatDate(n.createdAt)}).{" "}
            {n.taskId ? <Link href={`/tasks/${n.taskId}`}>Open task</Link> : null}{" "}
            {n.readAt ? null : (
              <button className="link-button" type="button" onClick={() => void markRead(n.id)}>
                Mark as read
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
