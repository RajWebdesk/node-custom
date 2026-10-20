import { Shell } from "../../components/Shell";
import { ActivityPanel } from "../../components/ActivityPanel";

export default function ActivityPage() {
  return (
    <Shell current="Activity">
      <h1>Activity</h1>
      <ActivityPanel />
    </Shell>
  );
}
