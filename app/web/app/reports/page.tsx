import { Shell } from "../../components/Shell";
import { MockTable } from "../../components/MockTable";

const byStatus = [
  { status: "In Review", count: 3 },
  { status: "In Progress", count: 5 },
];

export default function ReportsPage() {
  return (
    <Shell current="Reports">
      <h1>Reports</h1>
      <MockTable
        caption="Mock task counts by status. Sample data only."
        columns={[
          { key: "status", label: "Status" },
          { key: "count", label: "Tasks", numeric: true },
        ]}
        rows={byStatus}
      />
    </Shell>
  );
}
