import { Shell } from "../../components/Shell";
import { ReportsPanel } from "../../components/ReportsPanel";

export default function ReportsPage() {
  return (
    <Shell current="Reports">
      <h1>Reports</h1>
      <ReportsPanel />
    </Shell>
  );
}
