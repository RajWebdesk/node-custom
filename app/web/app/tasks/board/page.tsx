import { Shell } from "../../../components/Shell";
import { KanbanBoard } from "../../../components/KanbanBoard";

export default function BoardPage() {
  return (
    <Shell current="Tasks">
      <h1>Task board</h1>
      <KanbanBoard />
    </Shell>
  );
}
