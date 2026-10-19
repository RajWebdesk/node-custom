import { Shell } from "../../components/Shell";
import { MockTable } from "../../components/MockTable";
import { mockUsers } from "../../lib/mock";

export default function UsersPage() {
  return (
    <Shell current="Users">
      <h1>Users</h1>
      <MockTable
        caption="Mock user list. Sample rows only. Administrator only in the spec."
        columns={[
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "role", label: "Role" },
          { key: "status", label: "Status" },
        ]}
        rows={mockUsers}
      />
    </Shell>
  );
}
