import { Shell } from "../../components/Shell";
import { TasksPanel } from "../../components/TasksPanel";

export default function TasksPage() {
  return (
    <Shell current="Tasks">
      <h1>Tasks</h1>
      <TasksPanel />
    </Shell>
  );
}
