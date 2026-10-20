"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

// Unread count in the header (Task #11.2). Links to the inbox. The API returns only this person's count.
export function NotificationBell() {
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    apiRequest("/api/v1/notifications?limit=1")
      .then(async (res) => {
        if (res.ok) setUnread(((await res.json()) as { unreadCount: number }).unreadCount);
      })
      .catch(() => setUnread(null));
  }, []);

  return (
    <Link href="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
      Notifications{unread ? ` (${unread})` : ""}
    </Link>
  );
}
