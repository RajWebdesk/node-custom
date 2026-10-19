import { Shell } from "../../components/Shell";
import { MockTable } from "../../components/MockTable";
import { mockTasks } from "../../lib/mock";

export default function TasksPage() {
  return (
    <Shell current="Tasks">
      <h1>Tasks</h1>
      <MockTable
        caption="Mock task list. Sample rows only."
        columns={[
          { key: "title", label: "Task" },
          { key: "status", label: "Status" },
          { key: "due", label: "Due" },
          { key: "plannedHours", label: "Planned h", numeric: true },
        ]}
        rows={mockTasks}
      />
    </Shell>
  );
}
