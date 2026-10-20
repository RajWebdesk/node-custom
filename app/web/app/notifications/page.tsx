import { Shell } from "../../components/Shell";
import { NotificationsPanel } from "../../components/NotificationsPanel";

export default function NotificationsPage() {
  return (
    <Shell current="Notifications">
      <h1>Notifications</h1>
      <NotificationsPanel />
    </Shell>
  );
}
