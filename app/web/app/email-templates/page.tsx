import { Shell } from "../../components/Shell";
import { MockTable } from "../../components/MockTable";
import { mockTemplates } from "../../lib/mock";

export default function EmailTemplatesPage() {
  return (
    <Shell current="Email templates">
      <h1>Email templates</h1>
      <p className="kpi-label">Template text is a placeholder. No emails are sent in the pilot.</p>
      <MockTable
        caption="Mock templates. Sample rows only."
        columns={[
          { key: "name", label: "Template" },
          { key: "state", label: "State" },
        ]}
        rows={mockTemplates}
      />
    </Shell>
  );
}
