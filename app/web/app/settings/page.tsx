import { Shell } from "../../components/Shell";
import { StateMessage } from "../../components/StateMessage";

export default function SettingsPage() {
  return (
    <Shell current="Settings">
      <h1>Settings</h1>
      <div className="card narrow">
        <div className="field">
          <label htmlFor="timezone">Timezone</label>
          <input id="timezone" name="timezone" type="text" defaultValue="America/Toronto" readOnly />
        </div>
        <p className="kpi-label">Drives every displayed timestamp. Stored in UTC.</p>
      </div>
      <div className="gap-top">
        <StateMessage kind="read-only" />
      </div>
    </Shell>
  );
}
