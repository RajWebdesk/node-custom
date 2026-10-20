import { Shell } from "../../../components/Shell";
import { TaskNew } from "../../../components/TaskNew";

export default function NewTaskPage() {
  return (
    <Shell current="Tasks">
      <h1>New task</h1>
      <TaskNew />
    </Shell>
  );
}
