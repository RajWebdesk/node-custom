import { Shell } from "../../components/Shell";
import { UsersPanel } from "../../components/UsersPanel";

export default function UsersPage() {
  return (
    <Shell current="Users">
      <h1>Users</h1>
      <UsersPanel />
    </Shell>
  );
}
