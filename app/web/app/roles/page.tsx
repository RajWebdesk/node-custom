import { Shell } from "../../components/Shell";
import { RolesPanel } from "../../components/RolesPanel";

export default function RolesPage() {
  return (
    <Shell current="Roles">
      <h1>Roles and permissions</h1>
      <RolesPanel />
    </Shell>
  );
}
