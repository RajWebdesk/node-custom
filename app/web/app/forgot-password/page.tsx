import { Shell } from "../../components/Shell";

// Administrator-assisted reset only (spec). No self-service reset. Form does not submit.
export default function ForgotPasswordPage() {
  return (
    <Shell current="Sign in">
      <h1>Forgot password</h1>
      <form className="card login-card" aria-describedby="fp-note">
        <div className="field">
          <label htmlFor="fp-email">Email</label>
          <input id="fp-email" name="email" type="email" autoComplete="username" required />
        </div>
        <p id="fp-note" className="kpi-label">
          Prototype only. Reset is administrator-assisted. Not connected yet.
        </p>
        <button className="button" type="submit" disabled>
          Request reset
        </button>
      </form>
    </Shell>
  );
}
