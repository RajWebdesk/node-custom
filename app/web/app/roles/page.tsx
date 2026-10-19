import { Shell } from "../../components/Shell";
import { MockTable } from "../../components/MockTable";
import { roleMatrix } from "../../lib/mock";

export default function RolesPage() {
  return (
    <Shell current="Roles">
      <h1>Roles and permissions</h1>
      <p className="kpi-label">Three fixed roles. No custom permission builder (spec Out of Scope).</p>
      <MockTable
        caption="Mock role-by-module matrix. Rows follow the approved module list."
        columns={[
          { key: "module", label: "Module" },
          { key: "Administrator", label: "Administrator" },
          { key: "Manager", label: "Manager" },
          { key: "Employee", label: "Employee" },
        ]}
        rows={roleMatrix}
      />
    </Shell>
  );
}
