import { Shell } from "../../components/Shell";
import { MockTable } from "../../components/MockTable";
import { mockActivity } from "../../lib/mock";

export default function ActivityPage() {
  return (
    <Shell current="Activity">
      <h1>Activity</h1>
      <p className="kpi-label">Human-readable timeline. The immutable audit record is separate.</p>
      <MockTable
        caption="Mock activity. Sample rows only."
        columns={[
          { key: "when", label: "When" },
          { key: "actor", label: "Who" },
          { key: "action", label: "What" },
        ]}
        rows={mockActivity}
      />
    </Shell>
  );
}
