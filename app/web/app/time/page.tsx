import { Shell } from "../../components/Shell";
import { TimePanel } from "../../components/TimePanel";

export default function TimePage() {
  return (
    <Shell current="Time">
      <h1>Time</h1>
      <TimePanel />
    </Shell>
  );
}
