import { Shell } from "../../components/Shell";
import { ResetPanel } from "../../components/ResetPanel";

// Administrator-assisted reset only (spec). There is no self-service reset.
export default function ForgotPasswordPage() {
  return (
    <Shell current="Sign in">
      <h1>Reset your password</h1>
      <p className="kpi-label">Ask your administrator for a reset token, then enter it here.</p>
      <ResetPanel />
    </Shell>
  );
}
