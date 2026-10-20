"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, errorCode } from "../lib/api";

// Redeem an administrator-issued reset token (Task #4.3). No self-service reset: the token comes from an administrator.
const MESSAGES: Record<string, string> = {
  "invalid-or-expired-token": "This token is not valid. It may have expired or been used. Ask your administrator for a new one.",
  "validation-failed": "Check the token and use a new password of at least 12 characters.",
};

export function ResetPanel() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (password !== confirm) {
      setMessage("The two passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiRequest("/api/v1/auth/reset", { method: "POST", body: { token: token.trim(), newPassword: password } });
      if (res.status === 204) {
        router.push("/login");
        return;
      }
      const code = await errorCode(res);
      setMessage(MESSAGES[code] ?? "Could not reset the password. Try again later.");
    } catch {
      setMessage("Could not reach the server. Try again later.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form className="card login-card" onSubmit={onSubmit} aria-label="Reset password" noValidate>
        <div className="field">
          <label htmlFor="reset-token">Reset token</label>
          <input id="reset-token" name="token" autoComplete="off" required value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="reset-password">New password (at least 12 characters)</label>
          <input id="reset-password" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="reset-confirm">Confirm new password</label>
          <input id="reset-confirm" type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <p className="kpi-label">Resets are issued by an administrator. Each token works once and expires after 60 minutes.</p>
        <button className="button" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Set new password"}
        </button>
      </form>
      {message ? <div className="state state-error" role="alert"><p>{message}</p></div> : null}
      <p>
        <Link href="/login">Back to sign in</Link>
      </p>
    </>
  );
}
