import { Shell } from "../../components/Shell";
import { MockTable } from "../../components/MockTable";
import { mockNotifications } from "../../lib/mock";

export default function NotificationsPage() {
  const unread = mockNotifications.filter((n) => n.read === "No").length;
  return (
    <Shell current="Notifications">
      <h1>Notifications</h1>
      <p>Unread: {unread}</p>
      <MockTable
        caption="Mock notifications. In-app only in this prototype. No emails are sent."
        columns={[
          { key: "kind", label: "Notification" },
          { key: "task", label: "Task" },
          { key: "read", label: "Read" },
        ]}
        rows={mockNotifications}
      />
    </Shell>
  );
}
