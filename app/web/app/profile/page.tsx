import { Shell } from "../../components/Shell";
import { ProfilePanel } from "../../components/ProfilePanel";

export default function ProfilePage() {
  return (
    <Shell current="Profile">
      <h1>Profile</h1>
      <ProfilePanel />
    </Shell>
  );
}
