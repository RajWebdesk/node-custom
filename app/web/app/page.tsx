import { Shell } from "../components/Shell";
import { DashboardPanel } from "../components/DashboardPanel";

export default function Home() {
  return (
    <Shell current="Dashboard">
      <h1>Dashboard</h1>
      <DashboardPanel />
    </Shell>
  );
}
