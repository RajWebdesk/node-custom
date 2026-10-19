import { Shell } from "../../components/Shell";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <Shell current="Sign in">
      <h1>Sign in</h1>
      <LoginForm />
    </Shell>
  );
}
