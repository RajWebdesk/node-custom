import { Shell } from "../../components/Shell";
import { SettingsPanel } from "../../components/SettingsPanel";

export default function SettingsPage() {
  return (
    <Shell current="Settings">
      <h1>Settings</h1>
      <SettingsPanel />
    </Shell>
  );
}
