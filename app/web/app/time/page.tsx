import { Shell } from "../../components/Shell";
import { MockTable } from "../../components/MockTable";
import { StateMessage } from "../../components/StateMessage";
import { mockAllocations } from "../../lib/mock";

export default function TimePage() {
  return (
    <Shell current="Time">
      <h1>Time allocation</h1>
      <p className="kpi-label">Planned time, not time worked. Only the Administrator can change allocations.</p>
      <MockTable
        caption="Mock allocations. Sample rows only."
        columns={[
          { key: "subject", label: "Person" },
          { key: "plannedHours", label: "Planned h", numeric: true },
          { key: "updatedBy", label: "Updated by" },
          { key: "updatedAt", label: "Updated at" },
        ]}
        rows={mockAllocations}
      />
      <div className="gap-top">
        <StateMessage kind="read-only" />
      </div>
    </Shell>
  );
}
